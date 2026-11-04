// modules/Usuarios/vistas/login.ejs — el JavaScript de esta pantalla, sacado de la vista tal cual
// (FRO-4, 04/11/2026).

  (function () {
    // El aviso de la sesión larga, al marcar. Sin JavaScript la casilla sigue
    // funcionando: el aviso es ayuda, no un requisito.
    const c = document.getElementById('recordar');
    const a = document.getElementById('aviso-recordar');
    if (c && a) {
      const pinta = () => a.classList.toggle('hidden', !c.checked);
      c.addEventListener('change', pinta);
      pinta();
    }

    // Ver la contraseña. En un móvil, con prisa y el teclado tapando media
    // pantalla, es la diferencia entre entrar y equivocarse tres veces — y a la
    // tercera salta el freno anti fuerza bruta.
    const ojo = document.getElementById('ver-pass');
    const pass = document.getElementById('password');
    if (ojo && pass) {
      ojo.addEventListener('click', () => {
        const ver = pass.type === 'password';
        pass.type = ver ? 'text' : 'password';
        ojo.innerHTML = '<i class="fa-solid fa-eye' + (ver ? '-slash' : '') + '" aria-hidden="true"></i>';
        ojo.setAttribute('aria-label', ver ? 'Ocultar la contraseña' : 'Mostrar la contraseña');
        ojo.title = ver ? 'Ocultar la contraseña' : 'Mostrar la contraseña';
        pass.focus();
      });
    }

    // La sede: la última que se eligió en este navegador. Es una comodidad: si el
    // navegador no deja guardar, sale Madrid y ya.
    try {
      const guardada = localStorage.getItem('telecab-sede');
      const radio = guardada && document.querySelector('input[name="sede"][value="' + guardada + '"]');
      if (radio) radio.checked = true;
    } catch (e) { /* sin almacenamiento: Madrid */ }
    // Y la imagen de fondo es la de la sede: al cambiarla, se cruzan (layout-auth).
    const ponSede = v => document.documentElement.setAttribute('data-sede', v === 'barcelona' ? 'barcelona' : 'madrid');
    const marcada = document.querySelector('input[name="sede"]:checked');
    if (marcada) ponSede(marcada.value);
    document.querySelectorAll('input[name="sede"]').forEach(r => r.addEventListener('change', () => {
      ponSede(r.value);
      try { localStorage.setItem('telecab-sede', r.value); } catch (e) { /* nada */ }
    }));

    // Al enviar, el botón dice que está trabajando. El login va contra la base y
    // puede tardar un segundo; sin esto la gente pulsa dos y tres veces, y cada
    // pulsación es un intento más para el freno anti fuerza bruta.
    const f = document.getElementById('f-login');
    const b = document.getElementById('btn-entrar');
    const t = document.getElementById('btn-txt');
    if (f && b && t) {
      f.addEventListener('submit', ev => {
        // Con `novalidate` el navegador no pone su globo: se marca aquí el
        // campo que falta y se le da el foco.
        const vacio = [...f.querySelectorAll('input[required]')].find(i => !i.value.trim());
        if (vacio) { ev.preventDefault(); vacio.focus(); vacio.classList.add('falta'); return; }
        b.disabled = true;
        t.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Entrando…';
      });
      f.querySelectorAll('input[required]').forEach(i => i.addEventListener('input', () => i.classList.remove('falta')));
    }
  })();
