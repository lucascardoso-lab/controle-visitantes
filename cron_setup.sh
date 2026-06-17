#!/bin/bash
# ============================================================
# Agenda o encerramento automático dos visitantes às 23h
# ============================================================
(crontab -l 2>/dev/null; echo "0 23 * * * curl -s -X POST http://localhost/fechar-automatico") | crontab -

echo "Tarefa agendada com sucesso. Verifique com: crontab -l"
