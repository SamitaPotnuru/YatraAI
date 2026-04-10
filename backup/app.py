"""Entry point for local development. Production WSGI can import `app` from here."""

from yatraai import create_app

app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5001)
