"""One-off asset generation: VIP6 Ice Bear + VIP7 Golden Leopard entrance clips
(fal.ai Veo 3.1 image-to-video with native audio, via Emergent Universal Key).
Usage: python gen_vip_entrances.py <name> <frame.jpg> <out.mp4>
"""
import base64
import os
import sys
import time
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
# Fal Universal Key supports queue inference through Emergent proxy, not Platform APIs.
CONTROL_BASE = os.environ.get("INTEGRATION_PROXY_URL", "https://integrations.emergentagent.com").rstrip("/") + "/api/v1/fal"
PUBLIC_QUEUE_BASE = f"{CONTROL_BASE}/queue"
ENDPOINT = "fal-ai/veo3.1/image-to-video"

PROMPTS = {
    "bear": (
        "Cinematic ultra-realistic 3D VFX shot on a pure solid black background. A colossal, furious armored black bear "
        "with glowing icy-blue eyes, a silver crown with a blue diamond and jagged blue ice crystals on its back, "
        "charges aggressively toward the camera, stomps its giant crystal-clawed paw, rears its head and lets out a "
        "deafening, terrifying roar. Its FULL body always stays in frame in the lower half of the image. Icy-blue rim "
        "lighting, frost mist and glittering ice shards burst around it, premium luxurious lighting. Locked-off camera "
        "with a subtle push-in. The background must remain completely pure black for the whole clip, no ground, no "
        "environment, no text. Audio: a massive deep bear roar, heavy thudding footsteps, cracking ice, cinematic bass impact."
    ),
    "leopard": (
        "Cinematic ultra-realistic 3D VFX shot on a pure solid black background. A furious golden-yellow leopard with "
        "black rosette spots, a golden crystal crown and golden armor, sprints straight toward the camera, front-facing "
        "camera focused on its snarling face while it runs, fangs bared, golden fire energy and golden rock shards "
        "flying around its paws. Its FULL body always stays in frame in the lower half of the image. Premium warm "
        "golden lighting and sparkles, luxurious and powerful. The background must remain completely pure black for "
        "the whole clip, no ground, no environment, no text. Audio: powerful menacing leopard growls and a snarl, fast "
        "heavy paw footsteps, rumbling cinematic bass impact."
    ),
}
PROMPTS["bear_ref"] = (
    "Cinematic ultra-realistic 3D VFX shot on a pure solid black background. The colossal furious black ice bear with "
    "glowing icy-blue eyes, silver crown with a blue diamond, silver armor and jagged blue ice crystals on its back "
    "rises up onto its hind legs and stands tall facing the camera, front paws raised with huge crystal claws spread, "
    "throws its head back and roars ferociously with jaws wide open, then drops its head toward the camera and roars "
    "again aggressively, shoulders heaving with rage. Swirling icy-blue energy ribbons and frost lightning coil and "
    "crackle around its whole body, frost mist and glittering ice particles. Slow low-angle camera push-in. Its FULL "
    "body from ears to feet always stays inside the frame. Premium icy-blue rim lighting, luxurious and powerful. "
    "Background stays completely pure black the whole time, no forest, no ground, no environment, no text. "
    "Audio: a massive terrifying bear roar, a second deep roar, heavy breathing, crackling ice energy, deep cinematic bass hits."
)
PROMPTS["leopard_ref"] = (
    "Cinematic ultra-realistic 3D VFX shot on a pure solid black background. The furious golden-yellow leopard with "
    "black rosette spots, golden crystal crown and golden armor prowls powerfully straight toward the camera with "
    "heavy deliberate strides, shoulders rolling, head low and level, glowing golden eyes locked on the lens, lips "
    "curled in a menacing snarl. The camera smoothly tracks backward in front of it at eye level, focused on its face, "
    "keeping the same distance so its FULL body from ears to paws always stays inside the frame. With every step "
    "golden liquid-light energy splashes and sparks burst around its paws, golden fire wisps trail from its body. "
    "Premium warm golden lighting, luxurious and powerful. Background stays completely pure black the whole time, no "
    "water, no ground, no environment, no text. Audio: deep menacing leopard growls and a sharp snarl, heavy padded "
    "footsteps with energy splashes, rumbling cinematic bass."
)
NEG = "cartoon, low quality, blurry, text, watermark, background scenery, ground plane, cropped animal, extra limbs, deformed"


def _h(extra=None):
    h = {"Authorization": f"Bearer {EMERGENT_LLM_KEY}", "Content-Type": "application/json"}
    if os.environ.get("job_id"):
        h["X-App-ID"] = h["X-Job-ID"] = os.environ["job_id"]
    if extra:
        h.update(extra)
    return h


def _trusted(u):
    c, q = urlparse(u), urlparse(PUBLIC_QUEUE_BASE)
    assert c.scheme == q.scheme and c.netloc == q.netloc and c.path.startswith(q.path.rstrip("/") + "/"), u
    return u


def _get(url, deadline):
    for i in range(5):
        try:
            return requests.get(url, headers=_h(), timeout=60)
        except (requests.ConnectTimeout, requests.ReadTimeout, requests.ConnectionError):
            if i == 4 or time.monotonic() > deadline:
                raise
            time.sleep(2 ** i)


def main(name, frame, out):
    data = base64.b64encode(open(frame, "rb").read()).decode()
    payload = {
        "prompt": PROMPTS[name], "negative_prompt": NEG, "image_url": f"data:image/jpeg;base64,{data}",
        "aspect_ratio": "9:16", "duration": "6s", "resolution": "1080p", "generate_audio": True,
    }
    r = requests.post(f"{CONTROL_BASE}/proxy", headers=_h({"X-Fal-Target-Url": f"https://queue.fal.run/{ENDPOINT}"}), json=payload, timeout=60)
    if r.status_code == 402:
        sys.exit("INSUFFICIENT_CREDITS")
    if r.status_code >= 400:
        sys.exit(f"SUBMIT {r.status_code} {r.text[:500]}")
    sub = r.json()
    st, rs = _trusted(sub["status_url"]), _trusted(sub["response_url"])
    deadline = time.monotonic() + 1200
    while time.monotonic() < deadline:
        s = _get(st, deadline)
        s.raise_for_status()
        status = (s.json().get("status") or "").upper()
        print(name, status, flush=True)
        if status in {"COMPLETED", "OK"}:
            res = _get(rs, deadline)
            if res.status_code >= 400:
                sys.exit(f"RESULT {res.status_code} {res.text[:800]}")
            url = res.json()["video"]["url"]
            open(out, "wb").write(requests.get(url, timeout=300).content)
            print("SAVED", out, flush=True)
            return
        if status in {"FAILED", "CANCELLED", "CANCELED", "ERROR"}:
            sys.exit(f"FAILED {s.text[:500]}")
        time.sleep(5)
    sys.exit("TIMEOUT")


if __name__ == "__main__":
    main(*sys.argv[1:4])
