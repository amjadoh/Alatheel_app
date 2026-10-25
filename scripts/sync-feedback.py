"""Private app feedback export. Never execute user text or attachment content."""
import base64
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

REPO = "amjadoh/Alatheel_app"
BRANCH = "app-feedback"
BRIDGE = "https://us-central1-gen-lang-client-0145196991.cloudfunctions.net/feedbackBridge"
_identity = ("", 0)

def request(url, method="GET", data=None, headers=None):
    body = None if data is None else json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, body, {"Content-Type": "application/json", **(headers or {})}, method=method)
    with urllib.request.urlopen(req, timeout=100) as response:
        return json.load(response)

def github(path, method="GET", data=None):
    return request("https://api.github.com/repos/" + REPO + path, method, data, {
        "Authorization": "Bearer " + os.environ["GH_TOKEN"], "Accept": "application/vnd.github+json", "User-Agent": "Alatheel-feedback"})

def identity():
    global _identity
    if _identity[1] < time.time() + 60:
        token = request(os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"] + "&audience=alatheel-app-feedback", headers={
            "Authorization": "Bearer " + os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]})["value"]
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        _identity = token, claims["exp"]
    return _identity[0]

def bridge(action, **data):
    return request(BRIDGE, "POST", {"action": action, **data}, {"Authorization": "Bearer " + identity()})

def ensure_branch():
    try:
        github("/git/ref/heads/" + BRANCH)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        source = github("/git/ref/heads/main")["object"]["sha"]
        github("/git/refs", "POST", {"ref": "refs/heads/" + BRANCH, "sha": source})

def git_blob_sha(content):
    return hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()

def save_file(path, content):
    endpoint = "/contents/" + urllib.parse.quote(path, safe="/")
    try:
        existing = github(endpoint + "?ref=" + BRANCH)
        if existing.get("sha") != git_blob_sha(content):
            raise ValueError("Existing attachment differs; refusing to overwrite")
        return
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    github(endpoint, "PUT", {"branch": BRANCH, "message": "Archive app feedback attachment", "content": base64.b64encode(content).decode()})

def existing_issue(marker):
    # Listing is authoritative; search indexing may lag after an ambiguous POST.
    for page in range(1, 21):
        rows = github("/issues?state=all&sort=created&direction=desc&per_page=100&page=" + str(page))
        for row in rows:
            if marker in (row.get("body") or ""):
                return row
        if len(rows) < 100:
            return None
    raise ValueError("Issue history exceeds safe reconciliation limit")

def escape(value):
    return str(value).replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]").replace("<", "&lt;").replace(">", "&gt;")

def export_note(note):
    note_id = note["id"]
    if not note_id.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Invalid feedback id")
    marker = "<!-- alatheel-feedback:" + note_id + " -->"
    links = []
    for file in note["files"]:
        result = bridge("file", id=note_id, file=file["index"])
        content = base64.b64decode(result["base64"], validate=True)
        if len(content) != file["size"] or hashlib.sha256(content).hexdigest() != file["sha256"]:
            raise ValueError("Attachment integrity failed")
        extension = file["extension"]
        if not extension.isalnum() or len(extension) > 5:
            raise ValueError("Invalid file extension")
        path = "reports/" + note_id + "/file_" + str(int(file["index"])) + "." + extension
        save_file(path, content)
        url = "https://github.com/" + REPO + "/blob/" + BRANCH + "/" + path
        label = escape(file["name"])
        links.append("- [" + label + "](" + url + ")")
        if extension in ("jpg", "jpeg", "png", "webp", "gif"):
            links.append("\n![" + label + "](" + url + "?raw=true)\n")
    save_file("reports/" + note_id + "/note.json", json.dumps(note, ensure_ascii=False, indent=2).encode("utf-8"))
    issue = existing_issue(marker)
    if not issue:
        title = "ملاحظة التطبيق · " + (note["text"].splitlines()[0][:85] if note["text"] else "مرفقات من المدير")
        body = marker + "\n\n" + escape(note["text"] or "مرفقات فقط") + "\n\n---\n"
        body += "المدير: " + escape(note["createdByName"]) + "\n\nالإصدار: " + escape(note["version"]) + "\n\nالتاريخ: " + escape(note["createdAt"]) + "\n\n" + "\n".join(links)
        issue = github("/issues", "POST", {"title": title, "body": body})
    bridge("complete", id=note_id, number=issue["number"], url=issue["html_url"])
    return issue["number"]

def main():
    assert os.environ.get("GITHUB_REPOSITORY") == REPO
    try:
        request(BRIDGE)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            print("Feedback bridge is not deployed yet; no notes exported")
            return
        if error.code != 405:
            raise
    ensure_branch()
    exported = 0
    for _ in range(4):
        note = bridge("claim")["note"]
        if not note:
            break
        try:
            number = export_note(note)
            print("Feedback synchronized; issue", number)
            exported += 1
        except Exception:
            # Do not log private note text, file bytes, tokens or HTTP response bodies.
            bridge("failed", id=note["id"])
            raise RuntimeError("Feedback export failed; the saved note will be retried") from None
    print("Completed; synchronized notes:", exported)

if __name__ == "__main__":
    main()
