#!/usr/bin/env bash
# AutoniCK: demonstração LOCAL completa (Linux ou macOS). Uso: ./autonick-local.sh [--restaurar]
# Mesmo comportamento do AutoniCK-local.cmd. Não rode como root (o PostgreSQL recusa).
set -euo pipefail
cd "$(dirname "$0")/java/demo-pwa-local"
exec ./mvnw -q compile exec:java -Dautonick.main=br.com.ckgroup.autonick.demo.AutonickLocal -Dexec.args="$*"
