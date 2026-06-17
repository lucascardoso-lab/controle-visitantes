import sys
import os

# Caminho do projeto no servidor Ubuntu
sys.path.insert(0, '/var/www/controle-visitantes')

# Garante que o .env seja carregado mesmo via mod_wsgi
os.chdir('/var/www/controle-visitantes')

from app import app as application
