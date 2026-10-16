"""Couche de compatibilite « Flask » minimale, utilisee UNIQUEMENT si Flask
n'est pas installe sur le systeme (aucune installation n'est autorisee ici).

Elle implemente le sous-ensemble d'API utilise par ``app.py`` :

    Flask, request, Response, jsonify, render_template,
    send_from_directory, abort, HTTPException

... et fait tourner l'application sur ``wsgiref`` (bibliotheque standard Python).

Si Flask est reellement installe, ``app.py`` importe Flask et ce module n'est
jamais charge.
"""

from __future__ import annotations

import html as _html
import io
import json
import mimetypes
import os
import re
import threading
import traceback
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs, urlsplit
from wsgiref.simple_server import WSGIRequestHandler, WSGIServer, make_server

__all__ = [
    "Flask",
    "Request",
    "Response",
    "HTTPException",
    "abort",
    "jsonify",
    "request",
    "render_template",
    "send_from_directory",
]

_local = threading.local()

#: Garde-fou memoire : lecture d'un corps de requete / d'un fichier.
MAX_BODY_BYTES = 16 * 1024 * 1024
MAX_SEND_BYTES = 32 * 1024 * 1024

_STATUS_TEXT = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
    413: "Payload Too Large",
    415: "Unsupported Media Type",
    422: "Unprocessable Entity",
    500: "Internal Server Error",
    501: "Not Implemented",
    503: "Service Unavailable",
}

_DEFAULT_DESCRIPTIONS = {
    400: "Requete invalide.",
    403: "Acces interdit.",
    404: "Ressource introuvable.",
    405: "Methode non autorisee pour cette ressource.",
    413: "Fichier trop volumineux.",
    415: "Type de fichier non pris en charge.",
    500: "Erreur interne du serveur.",
}


# --------------------------------------------------------------------------- #
#  Erreurs HTTP
# --------------------------------------------------------------------------- #
class HTTPException(Exception):
    """Exception HTTP comparable a ``werkzeug.exceptions.HTTPException``."""

    def __init__(self, code: int, description: str | None = None):
        self.code = int(code)
        self.description = description or _DEFAULT_DESCRIPTIONS.get(
            self.code, "Erreur."
        )
        super().__init__("%d %s" % (self.code, self.description))

    def __str__(self) -> str:  # pragma: no cover - cosmetique
        return "%d %s" % (self.code, self.description)


def abort(code: int, description: str | None = None) -> None:
    """Leve une ``HTTPException`` (API identique a ``flask.abort``)."""
    raise HTTPException(code, description)


# --------------------------------------------------------------------------- #
#  Objets requete / reponse
# --------------------------------------------------------------------------- #
class Headers:
    """Dictionnaire d'en-tetes insensible a la casse."""

    def __init__(self, initial=None):
        self._data: dict[str, str] = {}
        if initial:
            self.update(initial)

    def __setitem__(self, key: str, value) -> None:
        self._data[str(key).lower()] = str(value)

    def __getitem__(self, key: str) -> str:
        return self._data[str(key).lower()]

    def __contains__(self, key: str) -> bool:
        return str(key).lower() in self._data

    def get(self, key: str, default=None):
        return self._data.get(str(key).lower(), default)

    def setdefault(self, key: str, default: str = "") -> str:
        return self._data.setdefault(str(key).lower(), str(default))

    def update(self, other) -> None:
        items = other.items() if hasattr(other, "items") else other
        for key, value in items:
            self[key] = value

    def items(self):
        return list(self._data.items())


class Request:
    """Objet requete (sous-ensemble de ``flask.Request``)."""

    def __init__(self, environ: dict):
        self.environ = environ
        self.method = str(environ.get("REQUEST_METHOD", "GET")).upper()
        self.path = environ.get("PATH_INFO") or "/"
        self.query_string = environ.get("QUERY_STRING", "")
        self.headers = Headers()
        for key, value in environ.items():
            if key.startswith("HTTP_"):
                self.headers[key[5:].replace("_", "-")] = value
        if environ.get("CONTENT_TYPE"):
            self.headers["Content-Type"] = environ["CONTENT_TYPE"]
        if environ.get("CONTENT_LENGTH"):
            self.headers["Content-Length"] = environ["CONTENT_LENGTH"]

        args = parse_qs(self.query_string, keep_blank_values=True)
        self.args = {key: values[0] for key, values in args.items() if values}
        self._body: bytes | None = None

    # -- corps ---------------------------------------------------------- #
    def get_data(self, as_text: bool = False, cache: bool = True) -> bytes | str:
        if self._body is None or not cache:
            try:
                length = int(self.environ.get("CONTENT_LENGTH") or 0)
            except (TypeError, ValueError):
                length = 0
            if length > MAX_BODY_BYTES:
                raise HTTPException(413, _DEFAULT_DESCRIPTIONS[413])
            stream = self.environ.get("wsgi.input")
            data = stream.read(length) if (stream is not None and length > 0) else b""
            if not cache:
                return data.decode("utf-8", "replace") if as_text else data
            self._body = data
        data = self._body
        return data.decode("utf-8", "replace") if as_text else data

    @property
    def data(self) -> bytes:
        return self.get_data()

    def get_json(self, silent: bool = False):
        text = self.get_data(as_text=True)
        try:
            return json.loads(text)
        except (ValueError, TypeError):
            if silent:
                return None
            raise HTTPException(400, "Corps JSON invalide.")

    # -- compatibilite -------------------------------------------------- #
    @property
    def files(self) -> dict:
        """Toujours vide : l'envoi brut (``fetch``) est utilise a la place."""
        return {}

    @property
    def form(self) -> dict:
        return {}


class Response:
    """Objet reponse minimal."""

    def __init__(self, response=None, status: int = 200, mimetype: str | None = None,
                 headers=None):
        self.headers = Headers()
        self.status_code = int(status)
        if headers:
            self.headers.update(headers)
        if mimetype:
            self.headers["Content-Type"] = mimetype
        self.data = response if response is not None else b""

    # -- data ----------------------------------------------------------- #
    @property
    def data(self) -> bytes:
        return self._data

    @data.setter
    def data(self, value) -> None:
        if value is None:
            value = b""
        elif isinstance(value, str):
            value = value.encode("utf-8")
        elif not isinstance(value, (bytes, bytearray)):
            value = str(value).encode("utf-8")
        self._data = bytes(value)

    def set_data(self, value) -> None:
        self.data = value

    @property
    def status(self) -> str:
        return "%d %s" % (self.status_code, _STATUS_TEXT.get(self.status_code, ""))

    @property
    def mimetype(self) -> str:
        ctype = self.headers.get("Content-Type", "")
        return ctype.split(";")[0].strip()


class _RequestProxy:
    """Proxy de requete comparable a ``flask.request``."""

    def _current(self) -> Request:
        current = getattr(_local, "request", None)
        if current is None:
            raise RuntimeError("Aucun contexte de requete actif.")
        return current

    def __getattr__(self, name: str):
        return getattr(self._current(), name)

    def __bool__(self) -> bool:
        return getattr(_local, "request", None) is not None


#: Instance globale utilisee par les vues, comme ``flask.request``.
request = _RequestProxy()


def jsonify(*args, **kwargs):
    """Retourne une ``Response`` JSON (API identique a ``flask.jsonify``)."""
    if args and kwargs:
        payload = {"args": args, **kwargs}
    elif kwargs:
        payload = kwargs
    elif args and len(args) == 1:
        payload = args[0]
    elif args:
        payload = list(args)
    else:
        payload = {}
    return Response(
        json.dumps(payload, ensure_ascii=False),
        status=200,
        mimetype="application/json; charset=utf-8",
    )


# --------------------------------------------------------------------------- #
#  Securite fichiers
# --------------------------------------------------------------------------- #
def _safe_real_path(directory: str, relative: str) -> str:
    """Resout ``relative`` dans ``directory`` en interdisant toute traversal."""
    if not relative or "\x00" in relative:
        raise HTTPException(400, "Chemin de fichier invalide.")
    normalized = relative.replace("\\", "/")
    if normalized.startswith("/") or any(
        part in ("..", "") for part in normalized.split("/")
    ):
        raise HTTPException(404, "Fichier introuvable.")
    base = os.path.realpath(directory)
    full = os.path.realpath(os.path.join(base, normalized))
    if full != base and not full.startswith(base + os.sep):
        raise HTTPException(404, "Fichier introuvable.")
    return full


def send_from_directory(directory: str, path: str, as_attachment: bool = False,
                        download_name: str | None = None,
                        mimetype: str | None = None) -> Response:
    """Envoie un fichier de maniere sure (API identique a Flask)."""
    full = _safe_real_path(directory, path)
    if not os.path.isfile(full):
        raise HTTPException(404, "Fichier introuvable.")
    size = os.path.getsize(full)
    if size > MAX_SEND_BYTES:
        raise HTTPException(413, "Fichier trop volumineux.")
    with open(full, "rb") as handle:
        data = handle.read()
    ctype = mimetype or mimetypes.guess_type(full)[0] or "application/octet-stream"
    response = Response(data, status=200, mimetype=ctype)
    if as_attachment:
        name = download_name or os.path.basename(full)
        response.headers["Content-Disposition"] = 'attachment; filename="%s"' % name
    return response


def render_template(template_name: str, **context) -> str:
    """Rend un gabarit HTML (substitution simple ``{{ var }}``, sans Jinja2)."""
    app = getattr(_local, "app", None)
    if app is None:
        raise RuntimeError("Aucun contexte d'application actif.")
    base = os.path.realpath(app.template_folder)
    full = os.path.realpath(os.path.join(base, template_name.replace("\\", "/")))
    if full != base and not full.startswith(base + os.sep):
        raise HTTPException(404, "Gabarit introuvable.")
    if not os.path.isfile(full):
        raise HTTPException(404, "Gabarit introuvable: %s" % template_name)
    with open(full, "r", encoding="utf-8") as handle:
        source = handle.read()

    def _replace(match: "re.Match[str]") -> str:
        key = match.group(1)
        if key not in context:
            return match.group(0)
        value = context[key]
        if hasattr(value, "__html__"):
            return str(value.__html__())
        return _html.escape(str(value), quote=True)

    return re.sub(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}", _replace, source)


# --------------------------------------------------------------------------- #
#  Application
# --------------------------------------------------------------------------- #
class _Route:
    __slots__ = ("rule", "pattern", "methods", "endpoint")

    def __init__(self, rule, pattern, methods, endpoint):
        self.rule = rule
        self.pattern = pattern
        self.methods = methods
        self.endpoint = endpoint


def _compile_rule(rule: str) -> "re.Pattern[str]":
    """Traduit une regle Flask ``/api/midi/<path:name>`` en regex."""
    parts = []
    index = 0
    for match in re.finditer(r"<(?:([A-Za-z_]+):)?([A-Za-z_][A-Za-z0-9_]*)>", rule):
        parts.append(re.escape(rule[index:match.start()]))
        converter = match.group(1) or "string"
        name = match.group(2)
        if converter == "path":
            parts.append("(?P<%s>.+)" % name)
        elif converter == "int":
            parts.append("(?P<%s>\\d+)" % name)
        else:
            parts.append("(?P<%s>[^/]+)" % name)
        index = match.end()
    parts.append(re.escape(rule[index:]))
    return re.compile("^" + "".join(parts) + "$")


def _import_root(import_name: str) -> str:
    import sys

    module = sys.modules.get(import_name)
    filename = getattr(module, "__file__", None) if module is not None else None
    if not filename:
        return os.getcwd()
    return os.path.dirname(os.path.abspath(filename))


class Flask:
    """Remplaçant minimal de ``flask.Flask`` (sous-ensemble utilise ici)."""

    def __init__(self, import_name: str, template_folder: str = "templates",
                 static_folder: str = "static", static_url_path: str = "/static"):
        self.import_name = import_name
        self.name = import_name
        self.root_path = _import_root(import_name)
        self.template_folder = os.path.abspath(os.path.join(self.root_path, template_folder))
        self.static_folder = os.path.abspath(os.path.join(self.root_path, static_folder))
        self.static_url_path = static_url_path.rstrip("/") or "/static"
        self.config: dict = {}
        self._routes: list[_Route] = []
        self._error_handlers: dict[int, object] = {}

    # -- enregistrement ------------------------------------------------- #
    def route(self, rule: str, methods=None):
        def decorator(endpoint):
            self.add_url_rule(rule, endpoint, methods=methods)
            return endpoint

        return decorator

    def add_url_rule(self, rule: str, endpoint, methods=None) -> None:
        method_set = {str(m).upper() for m in (methods or ["GET"])}
        if "GET" in method_set:
            method_set.add("HEAD")
        method_set.add("OPTIONS")
        self._routes.append(_Route(rule, _compile_rule(rule), method_set, endpoint))

    def errorhandler(self, code: int):
        def decorator(endpoint):
            self._error_handlers[int(code)] = endpoint
            return endpoint

        return decorator

    # -- execution ------------------------------------------------------ #
    def __call__(self, environ, start_response):
        try:
            response = self._dispatch(environ)
        except Exception:  # pragma: no cover - filet de securite
            traceback.print_exc()
            response = Response(
                "<h1>500 Internal Server Error</h1>", status=500,
                mimetype="text/html; charset=utf-8",
            )
        headers = [(key, value) for key, value in response.headers.items()]
        header_names = {key.lower() for key, _ in headers}
        if "content-type" not in header_names:
            headers.append(("Content-Type", "text/html; charset=utf-8"))
        if "content-length" not in header_names:
            headers.append(("Content-Length", str(len(response.data))))
        if "x-content-type-options" not in header_names:
            headers.append(("X-Content-Type-Options", "nosniff"))
        start_response(response.status, headers)
        if environ.get("REQUEST_METHOD") == "HEAD":
            return [b""]
        return [response.data]

    def _dispatch(self, environ) -> Response:
        path = environ.get("PATH_INFO") or "/"
        method = str(environ.get("REQUEST_METHOD", "GET")).upper()
        request = Request(environ)
        _local.request = request
        _local.app = self
        try:
            if path == self.static_url_path or path.startswith(self.static_url_path + "/"):
                if method not in ("GET", "HEAD"):
                    raise HTTPException(405, _DEFAULT_DESCRIPTIONS[405])
                relative = path[len(self.static_url_path):].lstrip("/")
                return send_from_directory(self.static_folder, relative)

            path_matched = False
            for route in self._routes:
                match = route.pattern.match(path)
                if not match:
                    continue
                path_matched = True
                if method not in route.methods:
                    continue
                if method == "OPTIONS":
                    response = Response(b"", status=204)
                    response.headers["Allow"] = ", ".join(sorted(route.methods))
                    return response
                return _coerce(route.endpoint(**match.groupdict()))
            if path_matched:
                raise HTTPException(405, _DEFAULT_DESCRIPTIONS[405])
            raise HTTPException(404, _DEFAULT_DESCRIPTIONS[404])
        except HTTPException as exc:
            return self._handle_error(exc, path)
        finally:
            _local.request = None
            _local.app = None

    def _handle_error(self, exc: HTTPException, path: str) -> Response:
        handler = self._error_handlers.get(exc.code)
        if handler is not None:
            try:
                return _coerce(handler(exc))
            except HTTPException as nested:
                exc = nested
            except Exception:  # pragma: no cover
                traceback.print_exc()
        if path.startswith("/api/"):
            return jsonify({"ok": False, "code": exc.code, "error": exc.description})
        page = (
            "<!doctype html><html lang='fr'><meta charset='utf-8'>"
            "<title>%(code)d</title><body style='font-family:system-ui'>"
            "<h1>%(code)d</h1><p>%(msg)s</p><p><a href='/'>Retour a l'accueil</a></p>"
            "</body></html>"
        ) % {"code": exc.code, "msg": _html.escape(str(exc.description))}
        return Response(page, status=exc.code, mimetype="text/html; charset=utf-8")

    # -- serveur -------------------------------------------------------- #
    def run(self, host: str = "127.0.0.1", port: int = 5002, debug: bool = False,
            **options) -> None:
        class ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
            daemon_threads = True

        server = make_server(
            host, int(port), self,
            handler_class=WSGIRequestHandler,
            server_class=ThreadingWSGIServer,
        )
        print(
            "Serveur (fallback wsgiref, Flask absent) : http://%s:%s/"
            % (host, port)
        )
        try:
            server.serve_forever()
        except KeyboardInterrupt:  # pragma: no cover
            print("\nArret du serveur.")
        finally:
            server.server_close()

    # -- client de test ------------------------------------------------- #
    def test_client(self):
        return _TestClient(self)


# --------------------------------------------------------------------------- #
#  Coercition des valeurs de retour (compatible Flask)
# --------------------------------------------------------------------------- #
def _coerce(result) -> Response:
    if isinstance(result, Response):
        return result
    if result is None:
        raise HTTPException(500, "Le vue n'a retourne aucune donnee.")
    if isinstance(result, (dict, list)):
        return jsonify(result)
    if isinstance(result, (tuple, list)):
        if len(result) == 2 and isinstance(result[1], int):
            response = _coerce(result[0])
            response.status_code = int(result[1])
            return response
        if len(result) == 3 and isinstance(result[1], int):
            response = _coerce(result[0])
            response.status_code = int(result[1])
            response.headers.update(result[2])
            return response
        if len(result) == 2 and hasattr(result[1], "items"):
            response = _coerce(result[0])
            response.headers.update(result[1])
            return response
        raise HTTPException(500, "Tuple de retour non pris en charge.")
    return Response(result, mimetype="text/html; charset=utf-8")


# --------------------------------------------------------------------------- #
#  Client de test (permet de verifier les routes sans serveur permanent)
# --------------------------------------------------------------------------- #
class _TestResponse:
    def __init__(self, status_line: str, headers, raw: bytes):
        self.status = status_line
        self.status_code = int(status_line.split(" ", 1)[0])
        self.headers = Headers(dict(headers))
        self.data = raw

    @property
    def text(self) -> str:
        return self.data.decode("utf-8", "replace")

    def get_json(self):
        try:
            return json.loads(self.data.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None

    @property
    def json(self):
        return self.get_json()


class _TestClient:
    def __init__(self, app: Flask):
        self.app = app

    def open(self, path: str, method: str = "GET", data=None, headers=None,
             content_type: str | None = None) -> _TestResponse:
        if isinstance(data, str):
            data = data.encode("utf-8")
        elif data is None:
            data = b""
        split = urlsplit(path)
        environ = {
            "REQUEST_METHOD": method.upper(),
            "PATH_INFO": split.path,
            "QUERY_STRING": split.query,
            "SERVER_NAME": "localhost",
            "SERVER_PORT": "80",
            "SERVER_PROTOCOL": "HTTP/1.1",
            "HTTP_HOST": "localhost",
            "REMOTE_ADDR": "127.0.0.1",
            "wsgi.url_scheme": "http",
            "wsgi.input": io.BytesIO(data),
            "wsgi.errors": io.StringIO(),
            "wsgi.multithread": False,
            "wsgi.multiprocess": False,
            "wsgi.run_once": False,
        }
        if content_type:
            environ["CONTENT_TYPE"] = content_type
        if data:
            environ["CONTENT_LENGTH"] = str(len(data))
        for key, value in (headers or {}).items():
            environ["HTTP_" + key.upper().replace("-", "_")] = str(value)

        captured: dict = {}

        def start_response(status, response_headers, exc_info=None):
            captured["status"] = status
            captured["headers"] = response_headers

        chunks = self.app(environ, start_response)
        raw = b"".join(chunks)
        return _TestResponse(captured["status"], captured["headers"], raw)

    def get(self, path: str, **kwargs) -> _TestResponse:
        return self.open(path, method="GET", **kwargs)

    def post(self, path: str, **kwargs) -> _TestResponse:
        return self.open(path, method="POST", **kwargs)

    def delete(self, path: str, **kwargs) -> _TestResponse:
        return self.open(path, method="DELETE", **kwargs)
