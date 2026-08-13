/* ============================================================
   CAFFÈ MORETTI — main.js
   Barra de progreso de lectura, parallax, reveals al hacer scroll,
   menú móvil, modo oscuro/claro y horario con indicador "abierto ahora".
   ============================================================ */
(function () {
  var prefersReducedMotion = !!(
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );

  // -----------------------------------------------------------
  // Transición a pantalla negra entre index.html y carta.html.
  // El estado "entering" (cubierto al cargar) ya lo puso el script
  // anti-flash en <head>, antes del primer paint — acá solo lo
  // desvanecemos. Si prefers-reduced-motion está activo, no se activó
  // ningún overlay al hacer click (ver más abajo), así que acá no hay
  // nada que desvanecer y este bloque no hace nada visible.
  // -----------------------------------------------------------
  var pageTransition = document.querySelector('.page-transition');
  if (pageTransition) {
    try { sessionStorage.removeItem('cm-page-transition'); } catch (e) {}
    // doble rAF: asegura que el navegador ya pintó el frame "cubierto"
    // antes de sacar la clase, para que la transición de opacidad se vea.
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        document.documentElement.classList.remove('is-entering');
      });
    });

    if (!prefersReducedMotion) {
      var exitLinks = document.querySelectorAll('a[href="carta.html"], a[href^="index.html"]');
      exitLinks.forEach(function (a) {
        if (a.target === '_blank') return;
        a.addEventListener('click', function (e) {
          var href = a.getAttribute('href');
          if (!href) return;
          e.preventDefault();
          try { sessionStorage.setItem('cm-page-transition', '1'); } catch (err) {}
          document.documentElement.classList.add('is-leaving');
          setTimeout(function () {
            window.location.href = href;
          }, 350);
        });
      });
    }
  }

  // -----------------------------------------------------------
  // Bug de bfcache: si el navegador restaura esta página desde el
  // caché de atrás/adelante (en vez de recargarla), el estado que
  // tenía justo antes de navegar (incluida la clase "is-leaving" con
  // el overlay tapando todo y pointer-events:auto) queda "congelado"
  // tal cual estaba. Sin este listener, volver con el botón atrás deja
  // la pantalla negra bloqueando cualquier interacción. Corre siempre,
  // sin importar si esta página tiene el overlay en el DOM — el
  // problema puede aparecer volviendo desde cualquiera de las dos.
  // -----------------------------------------------------------
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) {
      document.documentElement.classList.remove('is-leaving', 'is-entering');
      try { sessionStorage.removeItem('cm-page-transition'); } catch (err) {}
      // caso límite: si se salió con el menú móvil abierto por otra vía
      // que no fuera clickear un link (ej. cerrar la pestaña), que no
      // vuelva a aparecer abierto
      if (navToggle && navToggle.checked) {
        navToggle.checked = false;
        if (navToggleLabel) navToggleLabel.setAttribute('aria-expanded', 'false');
      }
    }
  });

  // -----------------------------------------------------------
  // Barra de progreso de lectura + marcador "grano"
  // -----------------------------------------------------------
  var fill = document.getElementById('progressFill');
  var bean = document.getElementById('progressBean');

  function updateProgress() {
    if (!fill || !bean) return; // esta página no tiene barra de progreso (ej. carta.html)
    var h = document.documentElement;
    var scrollTop = h.scrollTop || document.body.scrollTop;
    var height = h.scrollHeight - h.clientHeight;
    var pct = height > 0 ? (scrollTop / height) * 100 : 0;
    fill.style.width = pct + '%';
    bean.style.left = pct + '%';
  }
  document.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();

  // -----------------------------------------------------------
  // Revelado de bloques al hacer scroll (IntersectionObserver)
  // -----------------------------------------------------------
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -60px 0px' }
    );
    reveals.forEach(function (el) {
      io.observe(el);
    });
  } else {
    reveals.forEach(function (el) {
      el.classList.add('in-view');
    });
  }

  // -----------------------------------------------------------
  // Cerrar el menú móvil al pulsar un enlace
  // -----------------------------------------------------------
  var navToggle = document.getElementById('navToggle');
  var navToggleLabel = document.querySelector('.nav-toggle-label');
  document.querySelectorAll('.mast-nav a').forEach(function (a) {
    a.addEventListener('click', function () {
      if (navToggle) navToggle.checked = false;
      if (navToggleLabel) navToggleLabel.setAttribute('aria-expanded', 'false');
    });
  });

  // -----------------------------------------------------------
  // Accesibilidad del menú móvil: reflejar el estado abierto/cerrado
  // -----------------------------------------------------------
  if (navToggle && navToggleLabel) {
    navToggle.addEventListener('change', function () {
      navToggleLabel.setAttribute('aria-expanded', navToggle.checked ? 'true' : 'false');
    });
  }

  // -----------------------------------------------------------
  // Horario: "abierto ahora" / "cierra a las..." leyendo la propia
  // tabla del HTML (#hoursTable) — si se actualiza un horario en el
  // <td>, el badge se recalcula solo, sin tocar este archivo. Cada
  // <tr> lleva data-day con la convención de Date.getDay(): 0=domingo
  // ... 6=sábado.
  // -----------------------------------------------------------
  var hoursTable = document.getElementById('hoursTable');
  var hoursBadge = document.getElementById('hoursBadge');
  var DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  function parseTimeToMinutes(str) {
    var m = str.match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  function formatMinutes(mins) {
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return h + ':' + (m < 10 ? '0' : '') + m;
  }

  if (hoursTable && hoursBadge) {
    var updateHoursBadge = function () {
      var rows = Array.prototype.slice.call(hoursTable.querySelectorAll('tr[data-day]'));
      var schedule = {}; // { 0: {openMin, closeMin, row}, 1: {...}, ... }

      // limpiar el resaltado del día anterior antes de recalcular — si no,
      // en una pestaña que sigue abierta al cruzar la medianoche (o al
      // volver mucho después vía bfcache) quedarían dos días marcados
      // como "hoy" a la vez
      rows.forEach(function (row) { row.classList.remove('is-today'); });

      rows.forEach(function (row) {
        var day = parseInt(row.getAttribute('data-day'), 10);
        var timeText = row.children[1] ? row.children[1].textContent : '';
        var times = timeText.match(/\d{1,2}:\d{2}/g);
        if (times && times.length >= 2) {
          schedule[day] = {
            openMin: parseTimeToMinutes(times[0]),
            closeMin: parseTimeToMinutes(times[1]),
            row: row
          };
        }
      });

      var now = new Date();
      var today = now.getDay();
      var nowMin = now.getHours() * 60 + now.getMinutes();

      // resaltar la fila del día actual
      if (schedule[today]) {
        schedule[today].row.classList.add('is-today');
      }

      var todayEntry = schedule[today];
      if (todayEntry && nowMin >= todayEntry.openMin && nowMin < todayEntry.closeMin) {
        hoursBadge.textContent = 'Abierto ahora — cierra a las ' + formatMinutes(todayEntry.closeMin);
        hoursBadge.className = 'hours-badge hours-badge--open';
      } else {
        // buscar la próxima apertura: hoy más tarde (si todavía no abrió) o el próximo día con horario
        var next = null;
        for (var i = 0; i <= 7; i++) {
          var d = (today + i) % 7;
          var entry = schedule[d];
          if (!entry) continue;
          if (i === 0 && nowMin >= entry.openMin) continue; // hoy ya pasó la apertura, seguir buscando
          next = { day: d, openMin: entry.openMin };
          break;
        }
        if (next) {
          hoursBadge.textContent =
            'Cerrado ahora — abre ' + DAY_NAMES[next.day] + ' a las ' + formatMinutes(next.openMin);
        } else {
          hoursBadge.textContent = 'Cerrado ahora';
        }
        hoursBadge.className = 'hours-badge hours-badge--closed';
      }
    };

    updateHoursBadge();

    // si la página se restaura desde bfcache, puede haber pasado
    // cualquier cantidad de tiempo real — recalcular en vez de mostrar
    // un horario que quedó congelado del momento en que se cargó
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) updateHoursBadge();
    });
  }

  // -----------------------------------------------------------
  // Formulario de contacto → WhatsApp. No hay backend: el submit
  // arma el texto del mensaje y abre wa.me con todo precargado. La
  // persona confirma el envío desde WhatsApp, no desde este formulario.
  // Validación propia (no el tooltip nativo del navegador) + honeypot
  // silencioso anti-bots.
  // -----------------------------------------------------------
  var contactForm = document.getElementById('contactForm');
  if (contactForm) {
    var confirmMsg = document.getElementById('formConfirm');
    var confirmTimer = null;

    function showFieldError(field, show) {
      var wrap = field.closest('.form-field');
      if (!wrap) return;
      var err = wrap.querySelector('.form-error');
      wrap.classList.toggle('has-error', !!show);
      if (err) err.style.display = show ? 'block' : '';
    }

    function hideConfirm() {
      if (confirmMsg) confirmMsg.classList.remove('is-visible');
    }

    // tocar de nuevo el formulario oculta la confirmación anterior
    contactForm.addEventListener('input', hideConfirm);

    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();

      // honeypot: si un bot completó este campo oculto, se cancela en
      // silencio — sin mensaje de error, para no delatar la trampa
      var honeypot = contactForm.querySelector('#ccWebsite');
      if (honeypot && honeypot.value.trim() !== '') return;

      var nameField = contactForm.querySelector('#ccName');
      var contactField = contactForm.querySelector('#ccContact');
      var messageField = contactForm.querySelector('#ccMessage');
      var motivoField = contactForm.querySelector('#ccMotivo');

      var nombre = nameField.value.trim();
      var contacto = contactField.value.trim();
      var mensaje = messageField.value.trim();
      var motivo = motivoField ? motivoField.value.trim() : '';

      var valid = true;
      [ [nameField, nombre], [contactField, contacto], [messageField, mensaje] ].forEach(function (pair) {
        var ok = pair[1].length > 0;
        showFieldError(pair[0], !ok);
        if (!ok) valid = false;
      });
      if (!valid) return;

      var texto = '';
      if (motivo) texto += 'Motivo: ' + motivo + '\n';
      texto +=
        'Hola! Soy ' + nombre + '.\n' +
        mensaje +
        '\n\nContacto: ' + contacto;

      var url = 'https://wa.me/5355530224?text=' + encodeURIComponent(texto);
      window.open(url, '_blank');

      if (confirmMsg) {
        confirmMsg.classList.add('is-visible');
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(hideConfirm, 6000);
      }
    });
  }

  // -----------------------------------------------------------
  // Resaltar en el nav la sección que se está leyendo
  // -----------------------------------------------------------
  var navLinks = Array.prototype.slice.call(
    document.querySelectorAll('.mast-nav a[href^="#"]:not(.mast-cta)')
  );
  var navSections = navLinks
    .map(function (a) {
      return document.getElementById(a.getAttribute('href').slice(1));
    })
    .filter(Boolean);

  if ('IntersectionObserver' in window && navSections.length) {
    var navObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var link = navLinks.filter(function (a) {
            return a.getAttribute('href') === '#' + entry.target.id;
          })[0];
          if (!link) return;
          navLinks.forEach(function (a) { a.classList.remove('active'); });
          link.classList.add('active');
        });
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 }
    );
    navSections.forEach(function (s) { navObserver.observe(s); });
  }

  // -----------------------------------------------------------
  // Modo oscuro / claro
  // Carga inicial ya resuelta por el script inline en <head> (evita
  // flash). Acá solo: reflejar el aria-label correcto, manejar el
  // click, y priorizar la elección del usuario en localStorage.
  // -----------------------------------------------------------
  var THEME_KEY = 'caffe-moretti-theme';
  var themeToggle = document.getElementById('themeToggle');
  var mqDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function reflectThemeUI() {
    var isDark = currentTheme() === 'dark';
    if (themeToggle) {
      themeToggle.setAttribute(
        'aria-label',
        isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'
      );
    }
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    reflectThemeUI();
  }

  reflectThemeUI();

  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    });
  }

  // si el usuario todavía no eligió manualmente, seguir la preferencia
  // del sistema en vivo (sin pisar una elección ya guardada)
  if (mqDark) {
    var onSystemChange = function (e) {
      var stored = null;
      try { stored = localStorage.getItem(THEME_KEY); } catch (err) {}
      if (!stored) applyTheme(e.matches ? 'dark' : 'light');
    };
    if (mqDark.addEventListener) mqDark.addEventListener('change', onSystemChange);
    else if (mqDark.addListener) mqDark.addListener(onSystemChange); // Safari viejo
  }

  // -----------------------------------------------------------
  // Parallax de profundidad en fotos de Selezione y Contacto
  // (distinta velocidad que su contenedor al hacer scroll)
  // -----------------------------------------------------------
  var parallaxImgs = document.querySelectorAll('.parallax-img');
  if (!prefersReducedMotion && 'IntersectionObserver' in window && parallaxImgs.length) {
    var activeParallax = [];

    var parallaxObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var idx = activeParallax.indexOf(entry.target);
          if (entry.isIntersecting) {
            if (idx === -1) activeParallax.push(entry.target);
          } else if (idx !== -1) {
            activeParallax.splice(idx, 1);
          }
        });
      },
      { rootMargin: '120px 0px 120px 0px' }
    );
    parallaxImgs.forEach(function (img) { parallaxObserver.observe(img); });

    function updateParallax() {
      var vh = window.innerHeight || document.documentElement.clientHeight;
      activeParallax.forEach(function (img) {
        var rect = img.getBoundingClientRect();
        var center = rect.top + rect.height / 2;
        var progress = (center - vh / 2) / vh;
        progress = Math.max(-0.2, Math.min(0.2, progress));
        var offset = (progress * 10).toFixed(2);
        img.style.setProperty('--parallax-y', offset + 'px');
      });
    }

    var parallaxTicking = false;
    function onParallaxScroll() {
      if (parallaxTicking) return;
      parallaxTicking = true;
      window.requestAnimationFrame(function () {
        updateParallax();
        parallaxTicking = false;
      });
    }
    document.addEventListener('scroll', onParallaxScroll, { passive: true });
    updateParallax();
  }
})();
