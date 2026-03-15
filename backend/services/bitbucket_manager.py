"""Bitbucket Cloud API client (uses app passwords for auth)."""
import httpx

_BB_API = "https://api.bitbucket.org/2.0"


def _auth(username: str, token: str):
    """Bitbucket uses HTTP Basic auth: username + app password."""
    if username and token:
        return (username, token)
    return None


async def test_connection(username: str, token: str) -> dict:
    if not username or not token:
        return {"ok": False, "error": "Username and app password required"}
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{_BB_API}/user", auth=_auth(username, token))
        if r.status_code == 200:
            d = r.json()
            return {"ok": True, "login": d.get("username") or d.get("nickname"), "name": d.get("display_name")}
        return {"ok": False, "error": f"HTTP {r.status_code}: {r.json().get('error', {}).get('message', '')}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def list_repos(username: str, token: str, workspace: str) -> list[dict]:
    ws = workspace or username
    all_repos: list[dict] = []
    url = f"{_BB_API}/repositories/{ws}"
    params = {"pagelen": 100, "role": "member", "sort": "-updated_on"}
    auth = _auth(username, token)
    async with httpx.AsyncClient(timeout=15) as c:
        while url:
            try:
                r = await c.get(url, auth=auth, params=params)
                if r.status_code != 200:
                    break
                data = r.json()
                all_repos.extend(data.get("values", []))
                url = data.get("next", "")   # Bitbucket pagination
                params = {}                   # next URL already has params
            except Exception:
                break
    return all_repos


def normalize_repo(repo: dict, account: dict) -> dict:
    """Normalize a Bitbucket API repo dict to the common GitRepo shape."""
    # Extract HTTPS clone URL
    clone_url = ""
    for link in repo.get("links", {}).get("clone", []):
        if link.get("name") == "https":
            clone_url = link["href"]
            break

    return {
        "name": repo.get("slug") or repo.get("name", ""),
        "full_name": repo.get("full_name", ""),
        "description": repo.get("description") or "",
        "html_url": repo.get("links", {}).get("html", {}).get("href", ""),
        "clone_url": clone_url,
        "private": repo.get("is_private", False),
        "fork": repo.get("parent") is not None,
        "language": repo.get("language") or "",
        "updated_at": repo.get("updated_on", ""),
        "stargazers_count": 0,
        "platform": "bitbucket",
        "account_id": account["id"],
        "account_label": account.get("label", ""),
        "account_username": account.get("username", ""),
    }


def make_auth_clone_url(clone_url: str, username: str, token: str) -> str:
    """Inject credentials into Bitbucket HTTPS clone URL."""
    if username and token and "bitbucket.org" in clone_url:
        # Remove any existing user@ part, then inject username:token@
        import re
        clone_url = re.sub(r"https://[^@]*@", "https://", clone_url)
        return clone_url.replace("https://", f"https://{username}:{token}@")
    return clone_url
