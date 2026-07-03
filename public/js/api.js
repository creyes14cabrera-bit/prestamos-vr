// Wrapper fetch para hablar con el backend (/api/*). Reemplaza a guardar()/cargar() de
// localStorage: toda mutación va al servidor, y el estado local se refresca desde ahí.
(function () {
  const BASE = '/api';

  async function request(method, path, body) {
    const opts = {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(BASE + path, opts);
    let data = null;
    try { data = await res.json(); } catch (e) { /* respuesta sin cuerpo JSON */ }

    if (!res.ok) {
      const err = new Error((data && data.error) || `Error ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  window.api = {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body === undefined ? {} : body),
    put: (path, body) => request('PUT', path, body === undefined ? {} : body),
    del: (path) => request('DELETE', path)
  };
})();
