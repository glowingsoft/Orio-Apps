"""Iter-135 — Global text moderation (server-side, before delivery/publish).

Built-in Arabic + English abusive-word list + admin-editable extra terms
(db.config {_id: "banned_words"}). Matching is done on a normalized form
(lower-case, Arabic diacritics/tatweel removed, letter variants unified,
repeated letters collapsed, leetspeak mapped) to resist simple evasion.
"""
import re
import unicodedata

BUILTIN_EN = [
    "fuck", "fucking", "fucker", "motherfucker", "shit", "bullshit", "bitch", "bastard", "asshole",
    "dick", "pussy", "cunt", "whore", "slut", "nigger", "nigga", "faggot", "retard", "porn",
    "rape", "rapist", "cock", "wanker", "twat", "prick", "jerk off", "blowjob", "kill yourself", "kys",
]
BUILTIN_AR = [
    "كس", "كسمك", "كس امك", "كسختك", "زب", "زبي", "طيز", "شرموط", "شرموطة", "شراميط", "قحبة", "قحبه",
    "منيوك", "منيوكة", "نيك", "نيكك", "انيكك", "متناك", "خول", "لوطي", "عرص", "معرص", "ابن الكلب",
    "ابن الحرام", "يلعن", "يلعن ابوك", "حقير", "زاني", "زانية", "عاهرة", "عاهره", "سكس", "مخنث", "ديوث",
    "كلب", "حمار", "تفو",
]

_AR_DIACRITICS = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]")
_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i"})
_AR_MAP = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ة": "ه", "ؤ": "و", "ئ": "ي"})
_SEP = re.compile(r"[\s\.\-_\*\+~`'\"|/\\,;:]+")

_extra: list[str] = []


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFKC", text or "").lower()
    t = _AR_DIACRITICS.sub("", t).translate(_AR_MAP).translate(_LEET)
    t = re.sub(r"(.)\1{2,}", r"\1", t)  # "fuuuuck" → "fuck"
    return t


def set_extra(words: list[str]) -> None:
    global _extra
    _extra = [w.strip() for w in (words or []) if isinstance(w, str) and w.strip()]


def _terms() -> list[str]:
    return BUILTIN_EN + BUILTIN_AR + _extra


def find_violation(text: str):
    """Returns the first matched term (normalized), or None."""
    if not text:
        return None
    norm = normalize(text)
    words = set(re.findall(r"[\w\u0600-\u06FF]+", norm))
    squashed = _SEP.sub("", norm)  # "f.u.c.k" / "f u c k"
    for term in _terms():
        nt = normalize(term)
        if not nt:
            continue
        if " " in nt:
            if nt in norm or nt.replace(" ", "") in squashed:
                return nt
            continue
        if nt in words:
            return nt
        # Latin terms ≥4 chars also caught when glued/obfuscated.
        if nt.isascii() and len(nt) >= 4 and nt in squashed:
            return nt
        # Arabic terms with common prefixes (ال / و / يا) still blocked.
        if not nt.isascii() and any(w.endswith(nt) and len(w) - len(nt) <= 2 for w in words):
            return nt
    return None
