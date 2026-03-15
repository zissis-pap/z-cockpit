"""GitHub API client."""
import httpx

_GH_API = "https://api.github.com"


def _headers(token: str) -> dict:
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


async def test_connection(username: str, token: str) -> dict:
    url = f"{_GH_API}/user" if token else f"{_GH_API}/users/{username}"
    if not token and not username:
        return {"ok": False, "error": "Username or token required"}
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(url, headers=_headers(token))
        if r.status_code == 200:
            d = r.json()
            return {"ok": True, "login": d.get("login"), "name": d.get("name")}
        return {"ok": False, "error": f"HTTP {r.status_code}: {r.json().get('message', '')}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def list_repos(username: str, token: str) -> list[dict]:
    all_repos: list[dict] = []
    page = 1
    async with httpx.AsyncClient(timeout=15) as c:
        while True:
            url = f"{_GH_API}/user/repos" if token else f"{_GH_API}/users/{username}/repos"
            params = {"per_page": 100, "page": page, "sort": "updated",
                      **({"affiliation": "owner,collaborator"} if token else {})}
            try:
                r = await c.get(url, headers=_headers(token), params=params)
                if r.status_code != 200:
                    break
                batch = r.json()
                if not batch:
                    break
                all_repos.extend(batch)
                page += 1
                if len(batch) < 100:
                    break
            except Exception:
                break
    return all_repos


def normalize_repo(repo: dict, account: dict) -> dict:
    """Normalize a GitHub API repo dict to the common GitRepo shape."""
    return {
        "name": repo["name"],
        "full_name": repo.get("full_name", ""),
        "description": repo.get("description") or "",
        "html_url": repo.get("html_url", ""),
        "clone_url": repo.get("clone_url", ""),
        "private": repo.get("private", False),
        "fork": repo.get("fork", False),
        "language": repo.get("language") or "",
        "updated_at": repo.get("updated_at", ""),
        "stargazers_count": repo.get("stargazers_count", 0),
        "platform": "github",
        "account_id": account["id"],
        "account_label": account.get("label", ""),
        "account_username": account.get("username", ""),
    }


def make_auth_clone_url(clone_url: str, token: str) -> str:
    if token and "github.com" in clone_url:
        return clone_url.replace("https://", f"https://{token}@")
    return clone_url
