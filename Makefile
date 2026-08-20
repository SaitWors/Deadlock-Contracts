.PHONY: up down logs reset ps test smoke prod-config prod-up prod-logs backup security-check

up:
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f web worker

ps:
	docker compose ps

reset:
	docker compose down -v --remove-orphans
	docker compose up --build -d

test:
	PYTHONPATH=. python -m pytest -q

smoke:
	./scripts/smoke.sh

prod-config:
	docker compose --env-file .env.production -f compose.prod.yaml config --quiet

prod-up:
	docker compose --env-file .env.production -f compose.prod.yaml up -d --build

prod-logs:
	docker compose --env-file .env.production -f compose.prod.yaml logs -f web worker caddy

backup:
	./scripts/backup.sh

security-check:
	./scripts/security-check.sh
