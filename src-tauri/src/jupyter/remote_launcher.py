"""Run an owned Jupyter process for the lifetime of the SSH session."""

import importlib.util
import os
import select
import signal
import socket
import subprocess
import sys
import time
import urllib.request


def jupyter_module():
    for module in ("jupyterlab", "jupyter_server", "notebook"):
        if importlib.util.find_spec(module) is not None:
            return module
    raise SystemExit(
        "Jupyter is unavailable in this Python environment. "
        "Install JupyterLab or select a Python executable with Jupyter installed."
    )


def main():
    token = sys.stdin.readline().strip()
    if not token:
        return
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]

    module = jupyter_module()
    env = dict(os.environ, JUPYTER_TOKEN=token, JUPYTER_NO_CONFIG="1")
    root = os.path.expanduser("~")
    env["PATH"] = os.path.dirname(sys.executable) + os.pathsep + env.get("PATH", os.defpath)
    args = [
        sys.executable, "-m", module, "--no-browser", "--ip=127.0.0.1",
        "--port={}".format(port), "--port-retries=0", "--notebook-dir={}".format(root),
    ]
    if module != "notebook" and importlib.util.find_spec("jupyter_server_terminals") is not None:
        # The installed extension's config is skipped along with user config.
        args.append("--ServerApp.jpserver_extensions={'jupyter_server_terminals': True}")

    stopping = False

    def request_stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGHUP, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    child = subprocess.Popen(
        args,
        cwd=root,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=sys.stderr,
    )
    try:
        http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        status = urllib.request.Request(
            "http://127.0.0.1:{}/api/status".format(port),
            headers={"Authorization": "token " + token},
        )
        deadline = time.monotonic() + 60
        while child.poll() is None and time.monotonic() < deadline:
            if stopping or select.select([sys.stdin], [], [], 0.25)[0]:
                return
            try:
                with http.open(status, timeout=1) as response:
                    if (
                        response.status == 200
                        and response.geturl() == status.full_url
                        and child.poll() is None
                    ):
                        print("LABNEXUS_JUPYTER_PORT={}".format(port), flush=True)
                        break
            except OSError:
                continue
        else:
            code = child.poll()
            if code is None:
                raise SystemExit("Remote Jupyter did not become ready within 60 seconds.")
            raise SystemExit("Remote Jupyter exited during startup (status {}).".format(code))

        while child.poll() is None:
            if stopping or select.select([sys.stdin], [], [], 0.25)[0]:
                return
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=4)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    main()
