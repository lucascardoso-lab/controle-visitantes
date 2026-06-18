# INGOH - Controle de Visitantes

Sistema web para controle de acesso de visitantes, desenvolvido em Flask (Python) com banco de dados MySQL.

## Descrição

O sistema gerencia o fluxo completo de visitas em uma recepção: cadastro com captura de foto pela webcam, autopreenchimento de dados para visitantes recorrentes (por CPF), registro de saída, relatórios gerenciais e impressão de etiqueta de identificação. O acesso é protegido por login, com permissões diferentes por tipo de usuário (administrador, operador, visualizador).

## Funcionalidades

- Cadastro de visitantes com foto via webcam
- Autopreenchimento por CPF para visitantes recorrentes
- Registro de entrada e saída
- Relatórios (visitantes por dia/setor e tempo de estadia, com exportação em CSV)
- Página de administração (usuários e setores)
- Impressão de etiqueta 7,62 x 5,08 cm
- Login obrigatório em todas as rotas, com controle de permissão por tipo de usuário
- Encerramento automático das visitas em aberto às 23h (rota `POST /fechar-automatico`, pensada para ser chamada por uma tarefa agendada)

## Requisitos

- Python 3.10+
- MySQL Server 8.0+
- Apache2 (proxy reverso em produção)
- Bibliotecas Python: ver [requirements.txt](requirements.txt)
  - Flask 3.0.0
  - PyMySQL 1.1.0
  - python-dotenv 1.0.0
  - Werkzeug 3.0.1

## Instalação no Linux (Ubuntu/Debian)

As instruções abaixo assumem um servidor Ubuntu/Debian limpo e usam `/var/www/controle-visitantes` como diretório da aplicação e `controle-visitantes` como nome do serviço systemd.

### 1. Atualizar o sistema

```bash
sudo apt update && sudo apt upgrade -y
```

### 2. Instalar dependências (Python, MySQL, Apache)

```bash
sudo apt install -y python3 python3-venv python3-pip mysql-server apache2 git
```

### 3. Clonar o repositório do GitHub

```bash
sudo mkdir -p /var/www/controle-visitantes
sudo chown $USER:$USER /var/www/controle-visitantes
git clone https://github.com/lucascardoso-lab/controle-visitantes.git /var/www/controle-visitantes
cd /var/www/controle-visitantes
```

### 4. Criar ambiente virtual e instalar requirements.txt

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install gunicorn
```

### 5. Configurar o banco de dados MySQL

```bash
sudo mysql_secure_installation
```

Crie o usuário de aplicação, com permissões apenas sobre o banco do sistema:

```bash
sudo mysql -u root -p
```

```sql
CREATE USER 'visitante_app'@'localhost' IDENTIFIED BY 'SuaSenhaForte123!';
GRANT SELECT, INSERT, UPDATE, DELETE ON controle_visitantes.* TO 'visitante_app'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

> Use uma senha forte de verdade em produção — `SuaSenhaForte123!` é só o exemplo usado em [.env.example](.env.example).

### 6. Configurar o arquivo .env (usar .env.example como base)

```bash
cp .env.example .env
nano .env
```

```
DB_HOST=localhost
DB_USER=visitante_app
DB_PASSWORD=SuaSenhaForte123!
DB_NAME=controle_visitantes
SECRET_KEY=troque-esta-chave-por-algo-aleatorio
EMPRESA_NOME=INGOH
```

O `SECRET_KEY` é usado pelo Flask para assinar a sessão — gere um valor aleatório (`python3 -c "import secrets; print(secrets.token_hex(32))"`) e nunca reutilize o de exemplo.

### 7. Importar o schema.sql

```bash
sudo mysql -u root -p < schema.sql
```

Isso cria o banco `controle_visitantes`, as tabelas (`visitantes`, `setores`, `usuarios`) e um usuário administrador padrão do sistema:

- **login:** `admin`
- **senha:** `admin123`

> Altere essa senha pelo próprio painel administrativo (`/admin`) após o primeiro acesso.

### 8. Configurar Gunicorn como serviço systemd

Crie a unit `/etc/systemd/system/controle-visitantes.service`:

```ini
[Unit]
Description=Gunicorn - Controle de Visitantes
After=network.target mysql.service

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/controle-visitantes
EnvironmentFile=/var/www/controle-visitantes/.env
ExecStart=/var/www/controle-visitantes/venv/bin/gunicorn --workers 3 --bind 127.0.0.1:8000 app:app
Restart=always

[Install]
WantedBy=multi-user.target
```

Ajuste `--workers` conforme a quantidade de CPUs disponíveis (regra comum: `2 x núcleos + 1`).

```bash
sudo chown -R www-data:www-data /var/www/controle-visitantes
sudo systemctl daemon-reload
sudo systemctl enable --now controle-visitantes
sudo systemctl status controle-visitantes
```

### 9. Configurar Apache como proxy reverso com HTTPS

#### Gerar certificado autoassinado

```bash
sudo mkdir -p /etc/apache2/ssl
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/apache2/ssl/controle-visitantes.key \
  -out /etc/apache2/ssl/controle-visitantes.crt \
  -subj "/C=BR/ST=Estado/L=Cidade/O=INGOH/CN=visitantes.ingoh.local"
```

Em produção com domínio público, substitua o certificado autoassinado por um certificado válido (ex.: Let's Encrypt / Certbot).

#### Ativar módulos proxy, ssl, headers

```bash
sudo a2enmod proxy proxy_http ssl headers
```

#### Configurar VirtualHost HTTP (redireciona para HTTPS)

Crie `/etc/apache2/sites-available/controle-visitantes.conf`:

```apache
<VirtualHost *:80>
    ServerName visitantes.ingoh.local
    ServerAdmin webmaster@ingoh.com.br

    Redirect permanent / https://visitantes.ingoh.local/

    ErrorLog ${APACHE_LOG_DIR}/controle-visitantes-error.log
    CustomLog ${APACHE_LOG_DIR}/controle-visitantes-access.log combined
</VirtualHost>
```

#### Configurar VirtualHost HTTPS (proxy reverso para o Gunicorn)

Crie `/etc/apache2/sites-available/controle-visitantes-ssl.conf`:

```apache
<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName visitantes.ingoh.local
    ServerAdmin webmaster@ingoh.com.br

    SSLEngine on
    SSLCertificateFile /etc/apache2/ssl/controle-visitantes.crt
    SSLCertificateKeyFile /etc/apache2/ssl/controle-visitantes.key

    Alias /static /var/www/controle-visitantes/static
    <Directory /var/www/controle-visitantes/static>
        Require all granted
    </Directory>

    ProxyPreserveHost On
    ProxyPass /static !
    ProxyPass / http://127.0.0.1:8000/
    ProxyPassReverse / http://127.0.0.1:8000/

    RequestHeader set X-Forwarded-Proto "https"

    ErrorLog ${APACHE_LOG_DIR}/controle-visitantes-ssl-error.log
    CustomLog ${APACHE_LOG_DIR}/controle-visitantes-ssl-access.log combined
</VirtualHost>
</IfModule>
```

#### Ativar os sites e recarregar o Apache

```bash
sudo a2ensite controle-visitantes.conf
sudo a2ensite controle-visitantes-ssl.conf
sudo a2dissite 000-default.conf
sudo apache2ctl configtest
sudo systemctl reload apache2
```

> O repositório também inclui uma configuração alternativa via Apache + mod_wsgi em [apache_config.txt](apache_config.txt) e [controle_visitantes.wsgi](controle_visitantes.wsgi) (sem proxy reverso/Gunicorn, sem HTTPS). O caminho recomendado em produção é o desta seção (Gunicorn + proxy reverso + HTTPS).

### 10. Configurar Firewall (UFW)

```bash
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 'Apache Full'
sudo ufw enable
sudo ufw status
```

`Apache Full` libera as portas 80 e 443; a porta 8000 (Gunicorn) não precisa ser exposta, pois só recebe tráfego local do Apache.

### 11. Configurar backup automático do MySQL

Crie o script `/usr/local/bin/backup-controle-visitantes.sh`:

```bash
sudo tee /usr/local/bin/backup-controle-visitantes.sh > /dev/null <<'EOF'
#!/bin/bash
# Backup diário do banco controle_visitantes
set -e

DESTINO=/var/backups/controle-visitantes
DATA=$(date +%Y%m%d_%H%M%S)
ARQUIVO="$DESTINO/controle_visitantes_$DATA.sql.gz"

mkdir -p "$DESTINO"

set -a
source /var/www/controle-visitantes/.env
set +a

mysqldump -u "$DB_USER" -p"$DB_PASSWORD" -h "$DB_HOST" "$DB_NAME" | gzip > "$ARQUIVO"

# mantém apenas os últimos 7 dias de backup
find "$DESTINO" -name "*.sql.gz" -mtime +7 -delete
EOF
sudo chmod +x /usr/local/bin/backup-controle-visitantes.sh
```

Agende a execução diária via cron:

```bash
sudo crontab -e
```

```
0 2 * * * /usr/local/bin/backup-controle-visitantes.sh >> /var/log/backup-controle-visitantes.log 2>&1
```

Agende também o encerramento automático das visitas (às 23h), conforme [cron_setup.sh](cron_setup.sh):

```bash
bash cron_setup.sh
```

## Instalação no Windows (desenvolvimento)

### 1. Instalar Python

Baixe e instale o Python 3.10+ em [python.org](https://www.python.org/downloads/), marcando a opção "Add Python to PATH" durante a instalação.

### 2. Instalar MySQL

Instale o MySQL Server (ex.: MySQL Installer ou XAMPP) e crie o banco com o script [schema.sql](schema.sql):

```powershell
mysql -u root -p < schema.sql
```

### 3. Clonar repositório

```powershell
git clone https://github.com/lucascardoso-lab/controle-visitantes.git
cd controle-visitantes
```

### 4. Instalar dependências

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### 5. Configurar .env

```powershell
copy .env.example .env
notepad .env
```

```
DB_HOST=localhost
DB_USER=visitante_app
DB_PASSWORD=SuaSenhaForte123!
DB_NAME=controle_visitantes
SECRET_KEY=troque-esta-chave-por-algo-aleatorio
EMPRESA_NOME=INGOH
```

### 6. Rodar

```powershell
python app.py
```

O servidor de desenvolvimento do Flask inicia em `http://localhost:5000` (modo debug ativado, com reload automático ao salvar arquivos `.py`). A captura de foto pela webcam exige `getUserMedia`, que só funciona em `localhost` ou HTTPS — em desenvolvimento local isso já funciona sem configuração extra.

## Atualização do sistema em produção

```bash
cd /var/www/controle-visitantes
git pull
source venv/bin/activate
pip install -r requirements.txt
sudo mysql -u root -p controle_visitantes < schema.sql   # aplica eventuais novas tabelas/colunas
sudo systemctl restart controle-visitantes
```

## Comandos úteis

```bash
# Status e logs da aplicação (Gunicorn)
sudo systemctl status controle-visitantes
sudo journalctl -u controle-visitantes -f

# Status e logs do Apache
sudo systemctl status apache2
sudo tail -f /var/log/apache2/controle-visitantes-ssl-error.log

# Backup manual do banco
sudo /usr/local/bin/backup-controle-visitantes.sh
ls -lh /var/backups/controle-visitantes

# Tarefas agendadas (cron)
sudo crontab -l

# Reiniciar tudo após mudança de configuração
sudo systemctl restart controle-visitantes
sudo systemctl reload apache2
```

## Estrutura do projeto

```
controle-visitantes/
├── app.py                     # Aplicação Flask (rotas, regras de negócio, acesso ao MySQL)
├── schema.sql                 # Script de criação do banco e tabelas
├── requirements.txt           # Dependências Python
├── .env.example                # Modelo de variáveis de ambiente
├── static/                    # CSS, JavaScript e fotos capturadas (static/fotos/, não versionado)
├── templates/                 # Páginas HTML (Jinja2)
├── apache_config.txt          # Configuração alternativa via Apache + mod_wsgi
├── controle_visitantes.wsgi   # Ponto de entrada WSGI (usado pela configuração alternativa)
└── cron_setup.sh              # Agenda o encerramento automático das visitas
```
