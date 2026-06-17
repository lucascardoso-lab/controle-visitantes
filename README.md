# Controle de Visitantes - INGOH

Sistema web para controle de acesso de visitantes, desenvolvido em Flask (Python) com banco de dados MySQL.

## Descrição

O sistema permite:

- Cadastrar a entrada de visitantes (nome, CPF, data de nascimento, empresa, telefone, setor visitado e pessoa visitada), com impressão automática de etiqueta de identificação.
- Registrar a saída dos visitantes que ainda estão na empresa.
- Gerar relatórios de visitas por período/setor e por tempo de permanência, com exportação em CSV.
- Gerenciar usuários do sistema (administrador, operador, visualizador) e os setores disponíveis para visita, em uma área administrativa.
- Login obrigatório em todas as rotas, com controle de permissão por tipo de usuário.
- Encerramento automático das visitas em aberto às 23h (via rota `/fechar-automatico`, pensada para ser chamada por uma tarefa agendada/cron).

## Requisitos

- Python 3.10+
- MySQL Server 8.0+
- pip e venv (inclusos no Python)
- Para produção em Linux: Gunicorn

Dependências Python (arquivo [requirements.txt](requirements.txt)):

- Flask 3.0.0
- PyMySQL 1.1.0
- python-dotenv 1.0.0
- Werkzeug 3.0.1

## Como instalar

1. Clone o repositório e entre na pasta do projeto:

   ```bash
   git clone https://github.com/lucascardoso-lab/controle-visitantes.git
   cd controle-visitantes
   ```

2. Crie e ative um ambiente virtual:

   ```bash
   python -m venv venv
   source venv/bin/activate        # Linux/macOS
   venv\Scripts\activate           # Windows
   ```

3. Instale as dependências:

   ```bash
   pip install -r requirements.txt
   ```

4. Crie o banco de dados e as tabelas executando o script [schema.sql](schema.sql) no MySQL:

   ```bash
   mysql -u root -p < schema.sql
   ```

   Isso cria o banco `controle_visitantes`, as tabelas (`visitantes`, `setores`, `usuarios`) e um usuário administrador padrão:

   - **login:** `admin`
   - **senha:** `admin123`

   > Altere essa senha pelo próprio painel administrativo (`/admin`) após o primeiro acesso.

5. Configure as variáveis de ambiente: copie [.env.example](.env.example) para `.env` e ajuste os valores:

   ```bash
   cp .env.example .env
   ```

   ```
   DB_HOST=localhost
   DB_USER=visitante_app
   DB_PASSWORD=SuaSenhaForte123!
   DB_NAME=controle_visitantes
   SECRET_KEY=troque-esta-chave-por-algo-aleatorio
   EMPRESA_NOME=INGOH
   ```

   O `SECRET_KEY` é usado pelo Flask para assinar a sessão — gere um valor aleatório e nunca reutilize o de exemplo.

6. (Opcional) Crie o usuário de banco usado pela aplicação, caso ainda não exista, com permissões apenas sobre o banco do sistema:

   ```sql
   CREATE USER 'visitante_app'@'localhost' IDENTIFIED BY 'SuaSenhaForte123!';
   GRANT SELECT, INSERT, UPDATE, DELETE ON controle_visitantes.* TO 'visitante_app'@'localhost';
   FLUSH PRIVILEGES;
   ```

## Como rodar em desenvolvimento

Com o ambiente virtual ativado e o `.env` configurado:

```bash
python app.py
```

O servidor de desenvolvimento do Flask inicia em `http://localhost:5000` (modo debug ativado, com reload automático ao salvar arquivos `.py`).

## Como rodar em produção (Gunicorn no Linux)

1. No servidor Linux, repita os passos de instalação acima (clonar, criar venv, instalar dependências, configurar `.env`, aplicar `schema.sql`).

2. Instale o Gunicorn no ambiente virtual:

   ```bash
   pip install gunicorn
   ```

3. Suba a aplicação com Gunicorn, apontando para o objeto `app` definido em [app.py](app.py):

   ```bash
   gunicorn --workers 3 --bind 0.0.0.0:8000 app:app
   ```

   Ajuste `--workers` conforme a quantidade de CPUs disponíveis (regra comum: `2 x núcleos + 1`).

4. Recomenda-se colocar um proxy reverso (Nginx ou Apache) na frente do Gunicorn, encaminhando as requisições para `127.0.0.1:8000` e servindo os arquivos estáticos (`/static`) diretamente. Exemplo de bloco Nginx:

   ```nginx
   server {
       listen 80;
       server_name visitantes.ingoh.local;

       location /static/ {
           alias /var/www/controle-visitantes/static/;
       }

       location / {
           proxy_pass http://127.0.0.1:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

5. Para manter o Gunicorn rodando como serviço, crie uma unit do systemd (ex: `/etc/systemd/system/controle-visitantes.service`):

   ```ini
   [Unit]
   Description=Gunicorn - Controle de Visitantes
   After=network.target

   [Service]
   User=www-data
   WorkingDirectory=/var/www/controle-visitantes
   EnvironmentFile=/var/www/controle-visitantes/.env
   ExecStart=/var/www/controle-visitantes/venv/bin/gunicorn --workers 3 --bind 0.0.0.0:8000 app:app
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```

   Em seguida:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now controle-visitantes
   ```

6. Agende o encerramento automático das visitas (às 23h), conforme [cron_setup.sh](cron_setup.sh):

   ```bash
   bash cron_setup.sh
   ```

   Isso registra no crontab uma chamada diária a `POST /fechar-automatico`, que não exige login.

> O projeto também inclui uma configuração alternativa de produção via Apache + mod_wsgi em [apache_config.txt](apache_config.txt) e [controle_visitantes.wsgi](controle_visitantes.wsgi), caso prefira essa abordagem em vez de Gunicorn + proxy reverso.

## Estrutura do projeto

```
controle-visitantes/
├── app.py                     # Aplicação Flask (rotas, regras de negócio, acesso ao MySQL)
├── schema.sql                 # Script de criação do banco e tabelas
├── requirements.txt           # Dependências Python
├── .env.example                # Modelo de variáveis de ambiente
├── static/                    # CSS e JavaScript
├── templates/                 # Páginas HTML (Jinja2)
├── apache_config.txt          # Configuração alternativa via Apache + mod_wsgi
├── controle_visitantes.wsgi   # Ponto de entrada WSGI (usado pelo Apache)
└── cron_setup.sh              # Agenda o encerramento automático das visitas
```
