# Deploying the ORIO backend

1. Pull the latest code on the server and install dependencies:
   ```
   pip install -r backend/requirements.txt
   ```
   `websockets` must be installed, or uvicorn answers WebSocket requests with 404.

2. In `backend/.env`, make sure these are set (see `backend/env.example`):
   - `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
   - `UPLOAD_TMP_DIR` — optional; a folder the service user can write to, e.g. `/var/lib/orio/uploads`
     ```
     sudo mkdir -p /var/lib/orio/uploads && sudo chown <service-user> /var/lib/orio/uploads
     ```

3. Install the nginx config (adds the WebSocket upgrade headers):
   ```
   sudo cp deploy/nginx/orio.conf /etc/nginx/sites-available/orio
   sudo ln -sf /etc/nginx/sites-available/orio /etc/nginx/sites-enabled/orio
   sudo nginx -t && sudo systemctl reload nginx
   ```
   Set the `upstream` port to the one uvicorn listens on, and remove any older site file that also serves `/api/`.

4. Restart the backend service, then check:
   ```
   curl http://<server>/api/health
   ```
   Expect `{"db": true, "upload_tmp": true, "storage": "s3", "websockets": true}`.
   A WebSocket check should return `101 Switching Protocols`:
   ```
   curl -i -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
        -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" "http://<server>/api/ws/global?token=x"
   ```
   (With a dummy token the socket opens and then closes with code 4401.)

If uploads still fail, the backend log now records the real error (`journalctl -u <service> -n 100`).
