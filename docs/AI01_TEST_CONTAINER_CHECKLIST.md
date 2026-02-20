# AI01 Test Container Checklist

Use this checklist to validate A2A changes in an isolated AI01 test container before promoting to the production container.

## 1) Build Candidate Image on AI01

```bash
ssh user001@100.96.49.42 "mkdir -p ~/plexus-src-live"

rsync -az --delete --exclude ".git" --exclude "node_modules" --exclude "dist" --exclude ".worktrees" \
  "/mnt/ollama/git/plexus/plexus/" "user001@100.96.49.42:~/plexus-src-live/"

ssh user001@100.96.49.42 "cd ~/plexus-src-live && sudo podman build -t localhost/thearchitectit-plexus:a2a-test ."
```

## 2) Launch Isolated Test Container

Use a different container name and host port than production.

```bash
ssh user001@100.96.49.42 "sudo podman rm -f plexus-a2a-test 2>/dev/null || true"

ssh user001@100.96.49.42 "sudo podman run -d \
  --name plexus-a2a-test \
  -p 4101:4000 \
  -e DATABASE_URL=sqlite:///app/data/usage.sqlite \
  -v /home/user001/plexus/plexus.yaml:/app/config/plexus.yaml:ro \
  -v plexus-a2a-test-data:/app/data \
  localhost/thearchitectit-plexus:a2a-test"
```

## 3) Smoke Test the Test Container

```bash
ssh user001@100.96.49.42 "sudo podman ps --format '{{.Names}} {{.Image}} {{.Status}} {{.Ports}}'"

ssh user001@100.96.49.42 "curl -s -o /dev/null -w '/ui/metrics %{http_code}\n' http://127.0.0.1:4101/ui/metrics"
ssh user001@100.96.49.42 "curl -s -o /dev/null -w '/ui/live-metrics %{http_code}\n' http://127.0.0.1:4101/ui/live-metrics"
ssh user001@100.96.49.42 "curl -s -o /dev/null -w '/v1/models %{http_code}\n' http://127.0.0.1:4101/v1/models"
ssh user001@100.96.49.42 "curl -s -o /dev/null -w '/.well-known/agent-card.json %{http_code}\n' http://127.0.0.1:4101/.well-known/agent-card.json"
```

## 4) A2A Functional Verification

1. Open `http://AI01_HOST:4101/ui/metrics` and confirm it renders A2A Console.
2. Create a task via A2A Console and verify:
   - task appears in list
   - stream events populate
   - cancel works for non-terminal task
3. Verify A2A REST directly:

```bash
curl -s http://127.0.0.1:4101/.well-known/agent-card.json | jq .

curl -s -X POST http://127.0.0.1:4101/a2a/message/send \
  -H 'Content-Type: application/json' \
  -H 'A2A-Version: 0.3' \
  -H 'x-admin-key: <ADMIN_KEY>' \
  -d '{"message":{"role":"user","parts":[{"type":"text","text":"hello"}]}}' | jq .
```

4. Verify SSE subscribe from browser/CLI reaches live updates.

## 5) Log and Stability Checks

```bash
ssh user001@100.96.49.42 "sudo podman logs --tail 200 plexus-a2a-test"
ssh user001@100.96.49.42 "sudo podman stats --no-stream plexus-a2a-test"
```

Confirm there are no repeated auth errors, route failures, or push-delivery exceptions.

## 6) Promote to Production Container

Only after all checks pass:

1. Backup current production image tag first:

```bash
ssh user001@100.96.49.42 'TS=$(date +%Y%m%d-%H%M%S); CURRENT_ID=$(sudo podman inspect plexus --format "{{.Image}}"); sudo podman tag "$CURRENT_ID" "localhost/thearchitectit-plexus:pre-a2a-$TS"'
```

2. Retag test image as production tag.
3. Restart production container via `~/plexus/stop-plexus.sh` and `~/plexus/start-plexus.sh`.
4. Re-run health checks on production port (`4001`).

## 7) Cleanup Test Container

```bash
ssh user001@100.96.49.42 "sudo podman rm -f plexus-a2a-test"
```
