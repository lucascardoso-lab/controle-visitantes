# ============================================================
# Sistema de Controle de Acesso de Visitantes - INGOH
# Backend Flask + MySQL
# ============================================================

import os
import csv
import io
import base64
import pymysql
from functools import wraps

from flask import Flask, render_template, request, jsonify, Response, session, redirect, url_for
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash

# Carrega variáveis de ambiente do arquivo .env
load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'chave-padrao-insegura')

EMPRESA_NOME = os.getenv('EMPRESA_NOME', 'INGOH')

PASTA_FOTOS = os.path.join(app.static_folder, 'fotos')
os.makedirs(PASTA_FOTOS, exist_ok=True)
TAMANHO_MAXIMO_FOTO = 4 * 1024 * 1024  # 4MB decodificado


def get_db():
    return pymysql.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        user=os.getenv('DB_USER', 'root'),
        password=os.getenv('DB_PASSWORD', ''),
        database=os.getenv('DB_NAME', 'controle_visitantes'),
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor
    )


def validar_cpf(cpf):
    """Valida um CPF verificando os dígitos verificadores (mesma regra usada no frontend)."""
    cpf = ''.join(filter(str.isdigit, cpf or ''))
    if len(cpf) != 11 or cpf == cpf[0] * 11:
        return False
    for i in range(9, 11):
        soma = sum(int(cpf[num]) * ((i + 1) - num) for num in range(0, i))
        digito = ((soma * 10) % 11) % 10
        if digito != int(cpf[i]):
            return False
    return True


def buscar_visitante_por_cpf(cursor, cpf_digitos):
    """Busca o cadastro mais recente de um visitante pelos dígitos do CPF (ignora formatação)."""
    cursor.execute('''
        SELECT nome, data_nascimento, empresa, telefone, foto_path
        FROM visitantes
        WHERE REPLACE(REPLACE(cpf, '.', ''), '-', '') = %s
        ORDER BY hora_entrada DESC
        LIMIT 1
    ''', (cpf_digitos,))
    return cursor.fetchone()


def salvar_foto_base64(foto_base64, cpf_digitos):
    """Decodifica uma imagem em base64 (data URL) e grava em static/fotos/<cpf>.jpg."""
    if ',' in foto_base64:
        foto_base64 = foto_base64.split(',', 1)[1]

    try:
        conteudo = base64.b64decode(foto_base64, validate=True)
    except Exception:
        raise ValueError('Foto inválida.')

    if not conteudo or len(conteudo) > TAMANHO_MAXIMO_FOTO:
        raise ValueError('Foto inválida ou maior que o limite permitido (4MB).')

    caminho_arquivo = os.path.join(PASTA_FOTOS, f'{cpf_digitos}.jpg')
    with open(caminho_arquivo, 'wb') as arquivo:
        arquivo.write(conteudo)

    return f'fotos/{cpf_digitos}.jpg'


def admin_required(funcao):
    """Restringe o acesso a usuários autenticados com permissão 'admin'."""
    @wraps(funcao)
    def decorador(*args, **kwargs):
        if session.get('permissao') != 'admin':
            if request.path.startswith('/api/'):
                return jsonify({'sucesso': False, 'mensagem': 'Acesso restrito a administradores. Faça login novamente.'}), 401
            return redirect(url_for('login'))
        return funcao(*args, **kwargs)
    return decorador


ENDPOINTS_PUBLICOS = {'login', 'static', 'fechar_automatico'}


@app.before_request
def exigir_login():
    """Exige sessão autenticada em qualquer rota, exceto login, estáticos e o cron de fechamento automático."""
    if request.endpoint is None or request.endpoint in ENDPOINTS_PUBLICOS:
        return
    if 'usuario_id' not in session:
        if request.path.startswith('/api/'):
            return jsonify({'sucesso': False, 'mensagem': 'Sessão expirada. Faça login novamente.'}), 401
        return redirect(url_for('login'))


# ============================================================
# ROTAS DE PÁGINAS (HTML)
# ============================================================

@app.route('/')
def index():
    """Página de cadastro de visitantes."""
    return render_template('index.html', empresa_nome=EMPRESA_NOME)


@app.route('/saida')
def saida():
    """Página de registro de saída de visitantes."""
    return render_template('saida.html', empresa_nome=EMPRESA_NOME)


@app.route('/relatorios')
def relatorios():
    """Página de relatórios gerenciais."""
    return render_template('relatorios.html', empresa_nome=EMPRESA_NOME)


@app.route('/etiqueta')
def etiqueta():
    """Página de impressão da etiqueta/crachá do visitante."""
    visitante_id = request.args.get('id', '')
    return render_template('etiqueta.html', empresa_nome=EMPRESA_NOME, visitante_id=visitante_id)


# ============================================================
# ADMINISTRAÇÃO: AUTENTICAÇÃO
# ============================================================

@app.route('/login', methods=['GET', 'POST'])
def login():
    """Tela de login da aplicação."""
    if request.method == 'GET':
        return render_template('login.html', empresa_nome=EMPRESA_NOME)

    dados = request.get_json(silent=True) or request.form
    login_usuario = (dados.get('login') or '').strip()
    senha = dados.get('senha') or ''

    if not login_usuario or not senha:
        return jsonify({'sucesso': False, 'mensagem': 'Informe login e senha.'}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM usuarios WHERE login = %s', (login_usuario,))
        usuario = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao autenticar: {erro}'}), 500

    if not usuario or not check_password_hash(usuario['senha_hash'], senha):
        return jsonify({'sucesso': False, 'mensagem': 'Login ou senha inválidos.'}), 401

    session['usuario_id'] = usuario['id']
    session['usuario_nome'] = usuario['nome']
    session['permissao'] = usuario['permissao']

    return jsonify({'sucesso': True, 'mensagem': 'Login realizado com sucesso!', 'redirect': url_for('index')})


@app.route('/logout')
def logout():
    """Encerra a sessão do usuário."""
    session.clear()
    return redirect(url_for('login'))


@app.route('/admin')
@admin_required
def admin():
    """Painel administrativo: gestão de usuários e setores."""
    return render_template('admin.html', empresa_nome=EMPRESA_NOME)


# ============================================================
# API: USUÁRIOS (administração)
# ============================================================

@app.route('/api/usuarios')
@admin_required
def api_usuarios():
    """Lista os usuários cadastrados no painel administrativo."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, nome, login, permissao, criado_em FROM usuarios ORDER BY nome')
        usuarios = cursor.fetchall()
        conn.commit()
        cursor.close()
        conn.close()

        for usuario in usuarios:
            usuario['criado_em'] = usuario['criado_em'].strftime('%d/%m/%Y %H:%M') if usuario['criado_em'] else ''

        return jsonify({'sucesso': True, 'usuarios': usuarios})
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao buscar usuários: {erro}'}), 500


@app.route('/api/usuarios', methods=['POST'])
@admin_required
def api_criar_usuario():
    """Cria um novo usuário do painel administrativo."""
    dados = request.get_json(silent=True) or request.form

    nome = (dados.get('nome') or '').strip()
    login = (dados.get('login') or '').strip()
    senha = dados.get('senha') or ''
    permissao = (dados.get('permissao') or '').strip()

    if not nome or not login or not senha or permissao not in ('admin', 'operador', 'visualizador'):
        return jsonify({'sucesso': False, 'mensagem': 'Preencha nome, login, senha e uma permissão válida.'}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM usuarios WHERE login = %s', (login,))
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({'sucesso': False, 'mensagem': 'Já existe um usuário com esse login.'}), 400

        cursor.execute('''
            INSERT INTO usuarios (nome, login, senha_hash, permissao)
            VALUES (%s, %s, %s, %s)
        ''', (nome, login, generate_password_hash(senha), permissao))
        conn.commit()
        novo_id = cursor.lastrowid
        cursor.close()
        conn.close()

        return jsonify({'sucesso': True, 'mensagem': 'Usuário criado com sucesso!', 'id': novo_id})
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao criar usuário: {erro}'}), 500


@app.route('/api/usuarios/<int:usuario_id>', methods=['PUT'])
@admin_required
def api_editar_usuario(usuario_id):
    """Edita nome, login, permissão e (opcionalmente) a senha de um usuário."""
    dados = request.get_json(silent=True) or request.form

    nome = (dados.get('nome') or '').strip()
    login = (dados.get('login') or '').strip()
    senha = dados.get('senha') or ''
    permissao = (dados.get('permissao') or '').strip()

    if not nome or not login or permissao not in ('admin', 'operador', 'visualizador'):
        return jsonify({'sucesso': False, 'mensagem': 'Preencha nome, login e uma permissão válida.'}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()

        cursor.execute('SELECT id FROM usuarios WHERE login = %s AND id != %s', (login, usuario_id))
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({'sucesso': False, 'mensagem': 'Já existe outro usuário com esse login.'}), 400

        if permissao != 'admin':
            cursor.execute("SELECT COUNT(*) AS total FROM usuarios WHERE permissao = 'admin' AND id != %s", (usuario_id,))
            if cursor.fetchone()['total'] == 0:
                cursor.execute('SELECT permissao FROM usuarios WHERE id = %s', (usuario_id,))
                usuario_atual = cursor.fetchone()
                if usuario_atual and usuario_atual['permissao'] == 'admin':
                    cursor.close()
                    conn.close()
                    return jsonify({'sucesso': False, 'mensagem': 'Não é possível remover o único administrador do sistema.'}), 400

        if senha:
            cursor.execute('''
                UPDATE usuarios SET nome = %s, login = %s, senha_hash = %s, permissao = %s
                WHERE id = %s
            ''', (nome, login, generate_password_hash(senha), permissao, usuario_id))
        else:
            cursor.execute('''
                UPDATE usuarios SET nome = %s, login = %s, permissao = %s
                WHERE id = %s
            ''', (nome, login, permissao, usuario_id))

        conn.commit()
        afetados = cursor.rowcount
        cursor.close()
        conn.close()

        if afetados == 0:
            return jsonify({'sucesso': False, 'mensagem': 'Usuário não encontrado.'}), 404

        if session.get('usuario_id') == usuario_id:
            session['usuario_nome'] = nome
            session['permissao'] = permissao

        return jsonify({'sucesso': True, 'mensagem': 'Usuário atualizado com sucesso!'})
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao editar usuário: {erro}'}), 500


@app.route('/api/usuarios/<int:usuario_id>', methods=['DELETE'])
@admin_required
def api_excluir_usuario(usuario_id):
    """Exclui um usuário do painel administrativo."""
    if session.get('usuario_id') == usuario_id:
        return jsonify({'sucesso': False, 'mensagem': 'Você não pode excluir o próprio usuário enquanto estiver logado.'}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()

        cursor.execute('SELECT permissao FROM usuarios WHERE id = %s', (usuario_id,))
        usuario = cursor.fetchone()
        if not usuario:
            cursor.close()
            conn.close()
            return jsonify({'sucesso': False, 'mensagem': 'Usuário não encontrado.'}), 404

        if usuario['permissao'] == 'admin':
            cursor.execute("SELECT COUNT(*) AS total FROM usuarios WHERE permissao = 'admin'")
            if cursor.fetchone()['total'] <= 1:
                cursor.close()
                conn.close()
                return jsonify({'sucesso': False, 'mensagem': 'Não é possível excluir o único administrador do sistema.'}), 400

        cursor.execute('DELETE FROM usuarios WHERE id = %s', (usuario_id,))
        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({'sucesso': True, 'mensagem': 'Usuário excluído com sucesso!'})
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao excluir usuário: {erro}'}), 500


# ============================================================
# API: SETORES
# ============================================================

@app.route('/api/setores')
def api_setores():
    """Retorna a lista de setores cadastrados para preencher o dropdown."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, nome FROM setores ORDER BY nome')
        setores = cursor.fetchall()
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'sucesso': True, 'setores': setores})
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao buscar setores: {erro}'}), 500


@app.route('/api/setores', methods=['POST'])
@admin_required
def api_criar_setor():
    """Cria um novo setor (painel administrativo)."""
    dados = request.get_json(silent=True) or request.form
    nome = (dados.get('nome') or '').strip()

    if not nome:
        return jsonify({'sucesso': False, 'mensagem': 'Informe o nome do setor.'}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM setores WHERE LOWER(nome) = LOWER(%s)', (nome,))
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({'sucesso': False, 'mensagem': 'Já existe um setor com esse nome.'}), 400

        cursor.execute('INSERT INTO setores (nome) VALUES (%s)', (nome,))
        conn.commit()
        novo_id = cursor.lastrowid
        cursor.close()
        conn.close()

        return jsonify({'sucesso': True, 'mensagem': 'Setor criado com sucesso!', 'id': novo_id})
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao criar setor: {erro}'}), 500


@app.route('/api/setores/<int:setor_id>', methods=['PUT'])
@admin_required
def api_editar_setor(setor_id):
    """Edita o nome de um setor (painel administrativo)."""
    dados = request.get_json(silent=True) or request.form
    nome = (dados.get('nome') or '').strip()

    if not nome:
        return jsonify({'sucesso': False, 'mensagem': 'Informe o nome do setor.'}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM setores WHERE LOWER(nome) = LOWER(%s) AND id != %s', (nome, setor_id))
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({'sucesso': False, 'mensagem': 'Já existe outro setor com esse nome.'}), 400

        cursor.execute('UPDATE setores SET nome = %s WHERE id = %s', (nome, setor_id))
        conn.commit()
        afetados = cursor.rowcount
        cursor.close()
        conn.close()

        if afetados == 0:
            return jsonify({'sucesso': False, 'mensagem': 'Setor não encontrado.'}), 404

        return jsonify({'sucesso': True, 'mensagem': 'Setor atualizado com sucesso!'})
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao editar setor: {erro}'}), 500


@app.route('/api/setores/<int:setor_id>', methods=['DELETE'])
@admin_required
def api_excluir_setor(setor_id):
    """Exclui um setor (painel administrativo)."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM setores WHERE id = %s', (setor_id,))
        conn.commit()
        afetados = cursor.rowcount
        cursor.close()
        conn.close()

        if afetados == 0:
            return jsonify({'sucesso': False, 'mensagem': 'Setor não encontrado.'}), 404

        return jsonify({'sucesso': True, 'mensagem': 'Setor excluído com sucesso!'})
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao excluir setor: {erro}'}), 500


# ============================================================
# API: CADASTRO DE VISITANTE
# ============================================================

@app.route('/api/cadastrar', methods=['POST'])
def api_cadastrar():
    """Cadastra um novo visitante e retorna o ID gerado (usado para abrir a etiqueta)."""
    dados = request.get_json(silent=True) or request.form

    nome = (dados.get('nome') or '').strip()
    cpf = (dados.get('cpf') or '').strip()
    data_nascimento = (dados.get('data_nascimento') or '').strip()
    empresa = (dados.get('empresa') or '').strip()
    telefone = (dados.get('telefone') or '').strip()
    setor_visita = (dados.get('setor_visita') or '').strip()
    pessoa_visita = (dados.get('pessoa_visita') or '').strip()
    foto_base64 = (dados.get('foto_base64') or '').strip()

    if not nome or not cpf or not data_nascimento or not setor_visita or not pessoa_visita:
        return jsonify({'sucesso': False, 'mensagem': 'Preencha todos os campos obrigatórios.'}), 400

    if not validar_cpf(cpf):
        return jsonify({'sucesso': False, 'mensagem': 'CPF inválido. Verifique o número informado.'}), 400

    cpf_digitos = ''.join(filter(str.isdigit, cpf))

    try:
        conn = get_db()
        cursor = conn.cursor()

        if foto_base64:
            try:
                foto_path = salvar_foto_base64(foto_base64, cpf_digitos)
            except ValueError as erro_foto:
                cursor.close()
                conn.close()
                return jsonify({'sucesso': False, 'mensagem': str(erro_foto)}), 400
        else:
            visitante_anterior = buscar_visitante_por_cpf(cursor, cpf_digitos)
            foto_path = visitante_anterior['foto_path'] if visitante_anterior else None

        cursor.execute('''
            INSERT INTO visitantes
                (nome, cpf, data_nascimento, empresa, telefone, setor_visita, pessoa_visita, hora_entrada, status, foto_path)
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), 'ativo', %s)
        ''', (nome, cpf, data_nascimento, empresa, telefone, setor_visita, pessoa_visita, foto_path))
        conn.commit()
        novo_id = cursor.lastrowid
        cursor.close()
        conn.close()
        return jsonify({'sucesso': True, 'mensagem': 'Visitante cadastrado com sucesso!', 'id': novo_id})
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao cadastrar visitante: {erro}'}), 500


@app.route('/api/visitante/buscar')
def api_buscar_visitante_por_cpf():
    """Busca o cadastro mais recente de um visitante pelo CPF, para autopreenchimento."""
    cpf = request.args.get('cpf', '')
    cpf_digitos = ''.join(filter(str.isdigit, cpf))

    if not cpf_digitos:
        return jsonify({'sucesso': False, 'mensagem': 'Informe o CPF.'}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()
        visitante = buscar_visitante_por_cpf(cursor, cpf_digitos)
        conn.commit()
        cursor.close()
        conn.close()

        if not visitante:
            return jsonify({'sucesso': True, 'encontrado': False})

        if visitante['data_nascimento']:
            visitante['data_nascimento'] = visitante['data_nascimento'].strftime('%Y-%m-%d')

        return jsonify({'sucesso': True, 'encontrado': True, 'visitante': visitante})
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao buscar visitante: {erro}'}), 500


@app.route('/api/visitante/<int:visitante_id>')
def api_visitante(visitante_id):
    """Retorna os dados de um visitante específico (usado para montar a etiqueta)."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT * FROM visitantes WHERE id = %s', (visitante_id,))
        visitante = cursor.fetchone()
        conn.commit()
        cursor.close()
        conn.close()

        if not visitante:
            return jsonify({'sucesso': False, 'mensagem': 'Visitante não encontrado.'}), 404

        visitante['hora_entrada'] = visitante['hora_entrada'].strftime('%d/%m/%Y %H:%M') if visitante['hora_entrada'] else ''
        return jsonify({'sucesso': True, 'visitante': visitante})
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao buscar visitante: {erro}'}), 500


# ============================================================
# API: SAÍDA DE VISITANTES
# ============================================================

@app.route('/api/visitantes-ativos')
def api_visitantes_ativos():
    """Lista os visitantes com status ativo cadastrados no dia atual."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, nome, empresa, setor_visita, pessoa_visita, hora_entrada
            FROM visitantes
            WHERE status = 'ativo' AND DATE(hora_entrada) = CURDATE()
            ORDER BY hora_entrada DESC
        ''')
        visitantes = cursor.fetchall()
        conn.commit()
        cursor.close()
        conn.close()

        for visitante in visitantes:
            visitante['hora_entrada'] = visitante['hora_entrada'].strftime('%d/%m/%Y %H:%M')

        return jsonify({'sucesso': True, 'visitantes': visitantes})
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao buscar visitantes ativos: {erro}'}), 500


@app.route('/api/saida/<int:visitante_id>', methods=['POST'])
def api_saida(visitante_id):
    """Registra a saída (hora_saida + status encerrado) de um visitante."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE visitantes
            SET hora_saida = NOW(), status = 'encerrado'
            WHERE id = %s AND status = 'ativo'
        ''', (visitante_id,))
        conn.commit()
        afetados = cursor.rowcount
        cursor.close()
        conn.close()

        if afetados == 0:
            return jsonify({'sucesso': False, 'mensagem': 'Visitante não encontrado ou saída já registrada.'}), 404

        return jsonify({'sucesso': True, 'mensagem': 'Saída registrada com sucesso!'})
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao registrar saída: {erro}'}), 500


# ============================================================
# ENCERRAMENTO AUTOMÁTICO (23h - via cron)
# ============================================================

@app.route('/fechar-automatico', methods=['POST'])
def fechar_automatico():
    """Encerra automaticamente, às 23h, todos os visitantes ainda ativos do dia."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE visitantes
            SET hora_saida = CONCAT(CURDATE(), ' 23:00:00'),
                status = 'encerrado',
                encerrado_automatico = 1
            WHERE status = 'ativo' AND DATE(hora_entrada) = CURDATE()
        ''')
        conn.commit()
        total = cursor.rowcount
        cursor.close()
        conn.close()

        return jsonify({
            'sucesso': True,
            'mensagem': f'{total} visitante(s) encerrado(s) automaticamente às 23h.',
            'total': total
        })
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro no encerramento automático: {erro}'}), 500


# ============================================================
# RELATÓRIOS
# ============================================================

@app.route('/api/relatorio/dia-setor')
def api_relatorio_dia_setor():
    """Relatório de quantidade de visitantes por dia e setor, dentro de um período."""
    inicio = request.args.get('inicio')
    fim = request.args.get('fim')

    if not inicio or not fim:
        return jsonify({'sucesso': False, 'mensagem': 'Informe o período (data início e data fim).'}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT DATE(hora_entrada) AS data, setor_visita AS setor, COUNT(*) AS quantidade
            FROM visitantes
            WHERE DATE(hora_entrada) BETWEEN %s AND %s
            GROUP BY DATE(hora_entrada), setor_visita
            ORDER BY data, setor
        ''', (inicio, fim))
        linhas = cursor.fetchall()
        conn.commit()
        cursor.close()
        conn.close()

        for linha in linhas:
            linha['data'] = linha['data'].strftime('%d/%m/%Y')

        total = sum(linha['quantidade'] for linha in linhas)
        return jsonify({'sucesso': True, 'dados': linhas, 'total': total})
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao gerar relatório: {erro}'}), 500


def _consultar_tempo_estadia(data_filtro):
    """Consulta auxiliar usada tanto pelo relatório JSON quanto pela exportação CSV."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT nome, empresa, setor_visita, pessoa_visita, hora_entrada, hora_saida, foto_path
        FROM visitantes
        WHERE DATE(hora_entrada) = %s
        ORDER BY hora_entrada
    ''', (data_filtro,))
    linhas = cursor.fetchall()
    conn.commit()
    cursor.close()
    conn.close()
    return linhas


def _formatar_tempo_estadia(linha):
    """Calcula o tempo total de estadia (HH:MM) de uma linha de visitante."""
    entrada = linha['hora_entrada']
    saida = linha['hora_saida']
    if saida:
        segundos = int((saida - entrada).total_seconds())
        horas, resto = divmod(segundos, 3600)
        minutos = resto // 60
        tempo_total = f'{horas:02d}:{minutos:02d}'
        saida_fmt = saida.strftime('%d/%m/%Y %H:%M')
        return tempo_total, saida_fmt, segundos
    return 'Em visita', 'Em visita', None


@app.route('/api/relatorio/tempo-estadia')
def api_relatorio_tempo_estadia():
    """Relatório de tempo de estadia dos visitantes em uma data específica."""
    data_filtro = request.args.get('data')
    if not data_filtro:
        return jsonify({'sucesso': False, 'mensagem': 'Informe a data do relatório.'}), 400

    try:
        linhas = _consultar_tempo_estadia(data_filtro)
        resultado = []
        duracoes = []

        for linha in linhas:
            tempo_total, saida_fmt, segundos = _formatar_tempo_estadia(linha)
            if segundos is not None:
                duracoes.append(segundos)

            resultado.append({
                'nome': linha['nome'],
                'empresa': linha['empresa'] or '-',
                'setor': linha['setor_visita'],
                'entrada': linha['hora_entrada'].strftime('%d/%m/%Y %H:%M'),
                'saida': saida_fmt,
                'tempo_total': tempo_total,
                'foto_path': linha['foto_path']
            })

        if duracoes:
            media_segundos = sum(duracoes) // len(duracoes)
            horas, resto = divmod(media_segundos, 3600)
            minutos = resto // 60
            media_formatada = f'{horas:02d}:{minutos:02d}'
        else:
            media_formatada = '00:00'

        return jsonify({'sucesso': True, 'dados': resultado, 'media': media_formatada})
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao gerar relatório: {erro}'}), 500


@app.route('/api/relatorio/tempo-estadia/csv')
def api_relatorio_tempo_estadia_csv():
    """Exporta o relatório de tempo de estadia em formato CSV."""
    data_filtro = request.args.get('data')
    if not data_filtro:
        return jsonify({'sucesso': False, 'mensagem': 'Informe a data do relatório.'}), 400

    try:
        linhas = _consultar_tempo_estadia(data_filtro)

        buffer = io.StringIO()
        escritor = csv.writer(buffer, delimiter=';')
        escritor.writerow(['Nome', 'Empresa', 'Setor', 'Pessoa Visitada', 'Entrada', 'Saída', 'Tempo Total'])

        for linha in linhas:
            tempo_total, saida_fmt, _ = _formatar_tempo_estadia(linha)
            escritor.writerow([
                linha['nome'],
                linha['empresa'] or '-',
                linha['setor_visita'],
                linha['pessoa_visita'],
                linha['hora_entrada'].strftime('%d/%m/%Y %H:%M'),
                saida_fmt,
                tempo_total
            ])

        conteudo_csv = '﻿' + buffer.getvalue()
        buffer.close()

        return Response(
            conteudo_csv,
            mimetype='text/csv',
            headers={'Content-Disposition': f'attachment; filename=relatorio_estadia_{data_filtro}.csv'}
        )
    except Exception as erro:
        return jsonify({'sucesso': False, 'mensagem': f'Erro ao exportar relatório: {erro}'}), 500


# ============================================================
# TRATAMENTO DE ERROS
# ============================================================

@app.errorhandler(404)
def pagina_nao_encontrada(erro):
    if request.path.startswith('/api/'):
        return jsonify({'sucesso': False, 'mensagem': 'Recurso não encontrado.'}), 404
    return render_template('index.html', empresa_nome=EMPRESA_NOME), 404


@app.errorhandler(500)
def erro_interno(erro):
    return jsonify({'sucesso': False, 'mensagem': 'Erro interno no servidor. Tente novamente mais tarde.'}), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
