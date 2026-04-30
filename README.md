# curl2py Frontend

This app is the React frontend for the curl2py backend.

## Local setup

1. Start the FastAPI backend on `http://localhost:8000`.
2. Run the Vite app from `frontend/`.
3. The Vite dev server proxies `/api` and `/health` to the backend, so the frontend can call FastAPI without CORS issues.
4. If you want to point the frontend at a different backend URL, set `VITE_API_BASE_URL` in a local `.env` file.

The frontend now uses the backend for auth and curl conversion, and the converter page no longer loads a hardcoded demo request.
