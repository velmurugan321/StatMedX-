"""Authorization / tenant-isolation regression tests (IDOR via is_demo bypass).

Previously every ownership check was `owner_id != user.id and not user.is_demo`,
which short-circuited to False for ANY demo user — and demo tokens are handed
out with zero credentials via POST /api/auth/demo. That meant any demo user
could read/modify/export/delete every other user's datasets, results and
do-files. The bypass is now removed; plain ownership checks apply.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    # context manager ensures the startup event (create_all + seed) runs
    with TestClient(app) as c:
        yield c


def _register(client: TestClient) -> tuple[str, str]:
    email = f"victim_{uuid.uuid4().hex[:8]}@test.com"
    r = client.post("/api/auth/register", json={"email": email, "password": "secret123"})
    assert r.status_code == 200, r.text
    return email, r.json()["token"]


def test_demo_user_cannot_access_other_users_dataset(client):
    # register a normal user and create a private dataset
    _email, token = _register(client)
    r = client.post("/api/datasets/paste",
                    json={"text": "a,b\n1,2\n3,4", "name": "private data"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    ds_id = r.json()["id"]

    # log in as demo (zero credentials)
    r = client.post("/api/auth/demo")
    demo_token = r.json()["token"]

    # demo user must NOT be able to read / modify / delete the victim's dataset
    assert client.get(f"/api/datasets/{ds_id}",
                      headers={"Authorization": f"Bearer {demo_token}"}).status_code == 404
    assert client.get(f"/api/datasets/{ds_id}/data",
                      headers={"Authorization": f"Bearer {demo_token}"}).status_code == 404
    assert client.delete(f"/api/datasets/{ds_id}",
                         headers={"Authorization": f"Bearer {demo_token}"}).status_code == 404
    assert client.post(f"/api/datasets/{ds_id}/transform",
                       json={"op": "dedupe", "params": {}},
                       headers={"Authorization": f"Bearer {demo_token}"}).status_code == 404


def test_demo_user_cannot_read_other_users_results(client):
    _email, token = _register(client)
    r = client.post("/api/datasets/paste",
                    json={"text": "x\n1\n2\n3", "name": "victim ds"},
                    headers={"Authorization": f"Bearer {token}"})
    ds_id = r.json()["id"]
    r = client.post("/api/analysis",
                    json={"dataset_id": ds_id, "module": "descriptive_summarize",
                          "params": {"variables": ["x"]}},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    run_id = r.json()["id"]

    r = client.post("/api/auth/demo")
    demo_token = r.json()["token"]

    assert client.get(f"/api/results/{run_id}",
                      headers={"Authorization": f"Bearer {demo_token}"}).status_code == 404
    assert client.delete(f"/api/results/{run_id}",
                         headers={"Authorization": f"Bearer {demo_token}"}).status_code == 404
    assert client.get(f"/api/results/{run_id}/export?format=csv",
                      headers={"Authorization": f"Bearer {demo_token}"}).status_code == 404
    # listing never leaks other users' runs
    r = client.get("/api/results", headers={"Authorization": f"Bearer {demo_token}"})
    assert all(item["id"] != run_id for item in r.json())


def test_demo_user_cannot_access_other_users_dofiles(client):
    _email, token = _register(client)
    r = client.post("/api/dofiles",
                    json={"name": "secret.do", "content": "describe"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    fid = r.json()["id"]

    r = client.post("/api/auth/demo")
    demo_token = r.json()["token"]

    assert client.get("/api/dofiles",
                      headers={"Authorization": f"Bearer {demo_token}"}).json() == []
    assert client.delete(f"/api/dofiles/{fid}",
                         headers={"Authorization": f"Bearer {demo_token}"}).status_code == 404


def test_demo_user_still_sees_own_seeded_datasets(client):
    """The fix must not break the demo workspace: the demo user owns its seeded
    datasets, so plain ownership checks keep them accessible."""
    r = client.post("/api/auth/demo")
    demo_token = r.json()["token"]
    r = client.get("/api/datasets", headers={"Authorization": f"Bearer {demo_token}"})
    assert r.status_code == 200
    names = [d["name"] for d in r.json()]
    assert any("cardio_rct" in n for n in names)
    assert any("meta_studies" in n for n in names)


def test_other_user_cannot_access_victim_dataset_either(client):
    """Not just demo — ANY other user must be denied (plain ownership check)."""
    _email1, token1 = _register(client)
    r = client.post("/api/datasets/paste",
                    json={"text": "a\n1\n2", "name": "user1 private"},
                    headers={"Authorization": f"Bearer {token1}"})
    ds_id = r.json()["id"]

    _email2, token2 = _register(client)
    assert client.get(f"/api/datasets/{ds_id}",
                      headers={"Authorization": f"Bearer {token2}"}).status_code == 404
    assert client.delete(f"/api/datasets/{ds_id}",
                         headers={"Authorization": f"Bearer {token2}"}).status_code == 404
