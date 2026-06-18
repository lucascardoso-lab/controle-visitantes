/* ============================================================
   Sistema de Controle de Acesso de Visitantes - INGOH
   Script principal (JavaScript puro, sem dependências externas)
   ============================================================ */

const AppVisitantes = (function () {

  // ----------------------------------------------------------
  // UTILITÁRIOS GERAIS
  // ----------------------------------------------------------

  function mostrarToast(mensagem, tipo) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = mensagem;
    toast.className = 'toast show ' + (tipo === 'erro' ? 'toast-erro' : 'toast-sucesso');
    setTimeout(function () {
      toast.classList.remove('show');
    }, 3500);
  }

  function formatarDataHoraBR(dataIso) {
    if (!dataIso) return '-';
    const data = new Date(dataIso);
    if (isNaN(data.getTime())) return dataIso;
    const dia = String(data.getDate()).padStart(2, '0');
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const ano = data.getFullYear();
    const horas = String(data.getHours()).padStart(2, '0');
    const minutos = String(data.getMinutes()).padStart(2, '0');
    return `${dia}/${mes}/${ano} ${horas}:${minutos}`;
  }

  async function requisitarJson(url, opcoes) {
    const resposta = await fetch(url, opcoes);
    const dados = await resposta.json().catch(function () {
      return { sucesso: false, mensagem: 'Resposta inválida do servidor.' };
    });
    return { status: resposta.status, dados: dados };
  }

  // ----------------------------------------------------------
  // SIDEBAR (MENU HAMBURGUER MOBILE)
  // ----------------------------------------------------------

  function inicializarSidebar() {
    const btnHamburger = document.getElementById('btnHamburger');
    const sidebar = document.getElementById('sidebar');
    if (!btnHamburger || !sidebar) return;

    btnHamburger.addEventListener('click', function () {
      sidebar.classList.toggle('open');
    });

    document.addEventListener('click', function (evento) {
      if (!sidebar.classList.contains('open')) return;
      const cliqueDentro = sidebar.contains(evento.target) || btnHamburger.contains(evento.target);
      if (!cliqueDentro) {
        sidebar.classList.remove('open');
      }
    });
  }

  // ----------------------------------------------------------
  // MÁSCARAS E VALIDAÇÃO DE CPF
  // ----------------------------------------------------------

  function aplicarMascaraCpf(valor) {
    valor = valor.replace(/\D/g, '').slice(0, 11);
    if (valor.length > 9) {
      valor = valor.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
    } else if (valor.length > 6) {
      valor = valor.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
    } else if (valor.length > 3) {
      valor = valor.replace(/(\d{3})(\d{1,3})/, '$1.$2');
    }
    return valor;
  }

  function aplicarMascaraTelefone(valor) {
    valor = valor.replace(/\D/g, '').slice(0, 11);
    if (valor.length > 10) {
      valor = valor.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    } else if (valor.length > 6) {
      valor = valor.replace(/(\d{2})(\d{4})(\d{1,4})/, '($1) $2-$3');
    } else if (valor.length > 2) {
      valor = valor.replace(/(\d{2})(\d{1,5})/, '($1) $2');
    } else if (valor.length > 0) {
      valor = valor.replace(/(\d{1,2})/, '($1');
    }
    return valor;
  }

  function validarCpf(cpf) {
    cpf = (cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
      return false;
    }

    let soma = 0;
    for (let i = 0; i < 9; i++) {
      soma += parseInt(cpf.charAt(i), 10) * (10 - i);
    }
    let resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.charAt(9), 10)) return false;

    soma = 0;
    for (let i = 0; i < 10; i++) {
      soma += parseInt(cpf.charAt(i), 10) * (11 - i);
    }
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.charAt(10), 10)) return false;

    return true;
  }

  // ----------------------------------------------------------
  // PÁGINA: CADASTRO DE VISITANTE (index.html)
  // ----------------------------------------------------------

  function inicializarPaginaCadastro() {
    const form = document.getElementById('formCadastro');
    if (!form) return;

    const campoCpf = document.getElementById('cpf');
    const campoTelefone = document.getElementById('telefone');
    const campoHoraEntrada = document.getElementById('hora_entrada');
    const selectSetor = document.getElementById('setor_visita');
    const btnCadastrar = document.getElementById('btnCadastrar');
    const avisoCpfEncontrado = document.getElementById('avisoCpfEncontrado');

    // Preenche o horário de entrada automaticamente com a hora atual
    if (campoHoraEntrada) {
      campoHoraEntrada.value = formatarDataHoraBR(new Date().toISOString());
    }

    // Máscaras
    campoCpf.addEventListener('input', function () {
      campoCpf.value = aplicarMascaraCpf(campoCpf.value);
      campoCpf.classList.remove('erro');
    });

    campoTelefone.addEventListener('input', function () {
      campoTelefone.value = aplicarMascaraTelefone(campoTelefone.value);
    });

    campoCpf.addEventListener('blur', function () {
      autopreencherPorCpf(campoCpf.value, avisoCpfEncontrado);
    });

    inicializarCapturaFoto(form);

    // Carrega os setores cadastrados no banco
    carregarSetores(selectSetor);

    form.addEventListener('submit', async function (evento) {
      evento.preventDefault();

      if (!validarCpf(campoCpf.value)) {
        campoCpf.classList.add('erro');
        mostrarToast('CPF inválido. Verifique o número informado.', 'erro');
        campoCpf.focus();
        return;
      }
      campoCpf.classList.remove('erro');

      const dadosForm = {
        nome: document.getElementById('nome').value.trim(),
        cpf: campoCpf.value.trim(),
        data_nascimento: document.getElementById('data_nascimento').value,
        empresa: document.getElementById('empresa').value.trim(),
        telefone: campoTelefone.value.trim(),
        setor_visita: selectSetor.value,
        pessoa_visita: document.getElementById('pessoa_visita').value.trim(),
        foto_base64: document.getElementById('fotoBase64').value
      };

      btnCadastrar.disabled = true;
      btnCadastrar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';

      try {
        const { status, dados } = await requisitarJson('/api/cadastrar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dadosForm)
        });

        if (status === 200 && dados.sucesso) {
          mostrarToast('Visitante cadastrado com sucesso!', 'sucesso');
          pararCameraCadastro();
          window.location.href = '/etiqueta?id=' + dados.id;
        } else {
          mostrarToast(dados.mensagem || 'Não foi possível cadastrar o visitante.', 'erro');
        }
      } catch (erro) {
        mostrarToast('Falha de comunicação com o servidor.', 'erro');
      } finally {
        btnCadastrar.disabled = false;
        btnCadastrar.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Cadastrar e Imprimir Etiqueta';
      }
    });
  }

  // ----------------------------------------------------------
  // CAPTURA DE FOTO VIA WEBCAM (formulário de cadastro)
  // ----------------------------------------------------------

  let streamCameraCadastro = null;

  function pararCameraCadastro() {
    if (streamCameraCadastro) {
      streamCameraCadastro.getTracks().forEach(function (faixa) { faixa.stop(); });
      streamCameraCadastro = null;
    }
  }

  function inicializarCapturaFoto(form) {
    const video = document.getElementById('webcamPreview');
    const canvas = document.getElementById('canvasCaptura');
    const imgPreview = document.getElementById('fotoPreview');
    const placeholder = document.getElementById('fotoPlaceholder');
    const campoFotoBase64 = document.getElementById('fotoBase64');
    const btnAbrirCamera = document.getElementById('btnAbrirCamera');
    const btnTirarFoto = document.getElementById('btnTirarFoto');
    const btnRepetirFoto = document.getElementById('btnRepetirFoto');

    if (!video || !btnAbrirCamera) return;

    function mostrarApenasBotao(botaoVisivel) {
      [btnAbrirCamera, btnTirarFoto, btnRepetirFoto].forEach(function (botao) {
        botao.classList.toggle('hidden', botao !== botaoVisivel);
      });
    }

    btnAbrirCamera.addEventListener('click', async function () {
      try {
        streamCameraCadastro = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = streamCameraCadastro;
        video.classList.remove('hidden');
        placeholder.classList.add('hidden');
        imgPreview.classList.add('hidden');
        mostrarApenasBotao(btnTirarFoto);
      } catch (erro) {
        mostrarToast('Não foi possível acessar a câmera. Verifique as permissões do navegador.', 'erro');
      }
    });

    btnTirarFoto.addEventListener('click', function () {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      campoFotoBase64.value = dataUrl;
      imgPreview.src = dataUrl;
      imgPreview.classList.remove('hidden');
      video.classList.add('hidden');
      pararCameraCadastro();
      mostrarApenasBotao(btnRepetirFoto);
    });

    btnRepetirFoto.addEventListener('click', function () {
      campoFotoBase64.value = '';
      imgPreview.classList.add('hidden');
      placeholder.classList.remove('hidden');
      mostrarApenasBotao(btnAbrirCamera);
    });

    window.addEventListener('beforeunload', pararCameraCadastro);
  }

  async function autopreencherPorCpf(cpf, avisoCpfEncontrado) {
    if (!validarCpf(cpf)) {
      if (avisoCpfEncontrado) avisoCpfEncontrado.classList.add('hidden');
      return;
    }

    try {
      const { dados } = await requisitarJson('/api/visitante/buscar?cpf=' + encodeURIComponent(cpf));

      if (!dados.sucesso || !dados.encontrado) {
        if (avisoCpfEncontrado) avisoCpfEncontrado.classList.add('hidden');
        return;
      }

      const visitante = dados.visitante;
      document.getElementById('nome').value = visitante.nome || '';
      document.getElementById('data_nascimento').value = visitante.data_nascimento || '';
      document.getElementById('empresa').value = visitante.empresa || '';
      document.getElementById('telefone').value = visitante.telefone || '';

      if (visitante.foto_path) {
        const imgPreview = document.getElementById('fotoPreview');
        const placeholder = document.getElementById('fotoPlaceholder');
        const btnAbrirCamera = document.getElementById('btnAbrirCamera');
        const btnTirarFoto = document.getElementById('btnTirarFoto');
        const btnRepetirFoto = document.getElementById('btnRepetirFoto');

        pararCameraCadastro();
        document.getElementById('webcamPreview').classList.add('hidden');
        document.getElementById('fotoBase64').value = '';
        imgPreview.src = '/static/' + visitante.foto_path;
        imgPreview.classList.remove('hidden');
        placeholder.classList.add('hidden');
        [btnAbrirCamera, btnTirarFoto, btnRepetirFoto].forEach(function (botao) {
          botao.classList.toggle('hidden', botao !== btnRepetirFoto);
        });
      }

      if (avisoCpfEncontrado) {
        avisoCpfEncontrado.classList.remove('hidden');
        setTimeout(function () { avisoCpfEncontrado.classList.add('hidden'); }, 3500);
      }
    } catch (erro) {
      if (avisoCpfEncontrado) avisoCpfEncontrado.classList.add('hidden');
    }
  }

  async function carregarSetores(selectElemento) {
    if (!selectElemento) return;
    try {
      const { dados } = await requisitarJson('/api/setores');
      if (dados.sucesso) {
        dados.setores.forEach(function (setor) {
          const opcao = document.createElement('option');
          opcao.value = setor.nome;
          opcao.textContent = setor.nome;
          selectElemento.appendChild(opcao);
        });
      }
    } catch (erro) {
      mostrarToast('Não foi possível carregar os setores.', 'erro');
    }
  }

  // ----------------------------------------------------------
  // PÁGINA: ETIQUETA DE IMPRESSÃO (etiqueta.html)
  // ----------------------------------------------------------

  async function inicializarPaginaEtiqueta(visitanteId) {
    const btnImprimir = document.getElementById('btnImprimirNovamente');
    if (btnImprimir) {
      btnImprimir.addEventListener('click', function () {
        window.print();
      });
    }

    if (!visitanteId) {
      document.getElementById('campoNome').textContent = 'Visitante não informado';
      return;
    }

    try {
      const { dados } = await requisitarJson('/api/visitante/' + visitanteId);

      if (!dados.sucesso) {
        document.getElementById('campoNome').textContent = 'Visitante não encontrado';
        return;
      }

      const visitante = dados.visitante;
      document.getElementById('campoNome').textContent = visitante.nome;
      document.getElementById('campoEmpresa').textContent = visitante.empresa || '-';
      document.getElementById('campoSetor').textContent = visitante.setor_visita;
      document.getElementById('campoPessoaVisita').textContent = visitante.pessoa_visita;
      document.getElementById('campoHoraEntrada').textContent = visitante.hora_entrada;
      document.getElementById('campoProtocolo').textContent = String(visitante.id).padStart(6, '0');

      // Dispara a impressão automaticamente após renderizar os dados
      setTimeout(function () {
        window.print();
      }, 350);
    } catch (erro) {
      document.getElementById('campoNome').textContent = 'Erro ao carregar visitante';
    }
  }

  // ----------------------------------------------------------
  // PÁGINA: REGISTRAR SAÍDA (saida.html)
  // ----------------------------------------------------------

  let listaVisitantesAtivos = [];

  function inicializarPaginaSaida() {
    const corpoTabela = document.getElementById('corpoTabelaVisitantes');
    const campoBusca = document.getElementById('buscaVisitante');
    if (!corpoTabela) return;

    carregarVisitantesAtivos();

    campoBusca.addEventListener('input', function () {
      const termo = campoBusca.value.toLowerCase().trim();
      const filtrados = listaVisitantesAtivos.filter(function (visitante) {
        return visitante.nome.toLowerCase().includes(termo) ||
          (visitante.empresa || '').toLowerCase().includes(termo);
      });
      renderizarTabelaVisitantes(filtrados);
    });
  }

  async function carregarVisitantesAtivos() {
    const corpoTabela = document.getElementById('corpoTabelaVisitantes');
    try {
      const { dados } = await requisitarJson('/api/visitantes-ativos');
      if (dados.sucesso) {
        listaVisitantesAtivos = dados.visitantes;
        renderizarTabelaVisitantes(listaVisitantesAtivos);
      } else {
        corpoTabela.innerHTML = '<tr><td colspan="6" class="empty-state">Erro ao carregar visitantes.</td></tr>';
      }
    } catch (erro) {
      corpoTabela.innerHTML = '<tr><td colspan="6" class="empty-state">Falha de comunicação com o servidor.</td></tr>';
    }
  }

  function renderizarTabelaVisitantes(visitantes) {
    const corpoTabela = document.getElementById('corpoTabelaVisitantes');

    if (!visitantes.length) {
      corpoTabela.innerHTML = '<tr><td colspan="6" class="empty-state"><i class="fa-solid fa-circle-check"></i><br>Nenhum visitante ativo no momento.</td></tr>';
      return;
    }

    corpoTabela.innerHTML = visitantes.map(function (visitante) {
      return `
        <tr data-id="${visitante.id}">
          <td>${visitante.nome}</td>
          <td>${visitante.empresa || '-'}</td>
          <td>${visitante.setor_visita}</td>
          <td>${visitante.pessoa_visita}</td>
          <td>${visitante.hora_entrada}</td>
          <td>
            <button class="btn btn-success btn-sm btn-registrar-saida" data-id="${visitante.id}">
              <i class="fa-solid fa-check"></i> Registrar Saída
            </button>
          </td>
        </tr>
      `;
    }).join('');

    document.querySelectorAll('.btn-registrar-saida').forEach(function (botao) {
      botao.addEventListener('click', function () {
        registrarSaidaVisitante(botao.dataset.id, botao);
      });
    });
  }

  async function registrarSaidaVisitante(id, botao) {
    botao.disabled = true;
    botao.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Registrando...';

    try {
      const { status, dados } = await requisitarJson('/api/saida/' + id, { method: 'POST' });

      if (status === 200 && dados.sucesso) {
        mostrarToast('Saída registrada com sucesso!', 'sucesso');
        listaVisitantesAtivos = listaVisitantesAtivos.filter(function (visitante) {
          return String(visitante.id) !== String(id);
        });
        renderizarTabelaVisitantes(listaVisitantesAtivos);
      } else {
        mostrarToast(dados.mensagem || 'Não foi possível registrar a saída.', 'erro');
        botao.disabled = false;
        botao.innerHTML = '<i class="fa-solid fa-check"></i> Registrar Saída';
      }
    } catch (erro) {
      mostrarToast('Falha de comunicação com o servidor.', 'erro');
      botao.disabled = false;
      botao.innerHTML = '<i class="fa-solid fa-check"></i> Registrar Saída';
    }
  }

  // ----------------------------------------------------------
  // PÁGINA: RELATÓRIOS (relatorios.html)
  // ----------------------------------------------------------

  let ultimoTotaisPorSetor = {};
  let timeoutRedesenharGrafico = null;

  function inicializarPaginaRelatorios() {
    const btnFiltrarDiaSetor = document.getElementById('btnFiltrarDiaSetor');
    const btnFiltrarEstadia = document.getElementById('btnFiltrarEstadia');
    const btnExportarCsv = document.getElementById('btnExportarCsv');
    if (!btnFiltrarDiaSetor) return;

    const hoje = new Date().toISOString().slice(0, 10);
    document.getElementById('filtroInicio').value = hoje;
    document.getElementById('filtroFim').value = hoje;
    document.getElementById('filtroDataEstadia').value = hoje;

    btnFiltrarDiaSetor.addEventListener('click', carregarRelatorioDiaSetor);
    btnFiltrarEstadia.addEventListener('click', carregarRelatorioEstadia);
    btnExportarCsv.addEventListener('click', exportarCsvEstadia);

    window.addEventListener('resize', function () {
      clearTimeout(timeoutRedesenharGrafico);
      timeoutRedesenharGrafico = setTimeout(function () {
        desenharGraficoSetores(ultimoTotaisPorSetor);
      }, 150);
    });

    carregarRelatorioDiaSetor();
    carregarRelatorioEstadia();
  }

  async function carregarRelatorioDiaSetor() {
    const inicio = document.getElementById('filtroInicio').value;
    const fim = document.getElementById('filtroFim').value;
    const corpoTabela = document.getElementById('corpoTabelaDiaSetor');
    const totalCelula = document.getElementById('totalDiaSetor');

    if (!inicio || !fim) {
      mostrarToast('Selecione o período (data início e data fim).', 'erro');
      return;
    }

    try {
      const { dados } = await requisitarJson(`/api/relatorio/dia-setor?inicio=${inicio}&fim=${fim}`);

      if (!dados.sucesso) {
        corpoTabela.innerHTML = '<tr><td colspan="3" class="empty-state">Erro ao gerar relatório.</td></tr>';
        return;
      }

      if (!dados.dados.length) {
        corpoTabela.innerHTML = '<tr><td colspan="3" class="empty-state">Nenhum visitante encontrado no período.</td></tr>';
        totalCelula.textContent = '0';
        ultimoTotaisPorSetor = {};
        desenharGraficoSetores(ultimoTotaisPorSetor);
        return;
      }

      corpoTabela.innerHTML = dados.dados.map(function (linha) {
        return `
          <tr>
            <td>${linha.data}</td>
            <td>${linha.setor}</td>
            <td>${linha.quantidade}</td>
          </tr>
        `;
      }).join('');

      totalCelula.textContent = dados.total;

      const totaisPorSetor = {};
      dados.dados.forEach(function (linha) {
        totaisPorSetor[linha.setor] = (totaisPorSetor[linha.setor] || 0) + linha.quantidade;
      });
      ultimoTotaisPorSetor = totaisPorSetor;
      desenharGraficoSetores(ultimoTotaisPorSetor);
    } catch (erro) {
      mostrarToast('Falha ao carregar o relatório de dia/setor.', 'erro');
    }
  }

  function desenharGraficoSetores(totaisPorSetor) {
    const canvas = document.getElementById('graficoSetores');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const larguraCss = canvas.parentElement.clientWidth || 600;
    canvas.width = larguraCss;
    canvas.height = 260;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const setores = Object.keys(totaisPorSetor);
    if (!setores.length) {
      ctx.font = '14px Inter';
      ctx.fillStyle = '#6b7280';
      ctx.fillText('Sem dados para exibir no gráfico.', 16, 30);
      return;
    }

    const valores = setores.map(function (setor) { return totaisPorSetor[setor]; });
    const valorMaximo = Math.max.apply(null, valores);

    const margemEsquerda = 50;
    const margemInferior = 40;
    const margemSuperior = 20;
    const alturaUtil = canvas.height - margemInferior - margemSuperior;
    const larguraUtil = canvas.width - margemEsquerda - 20;
    const larguraBarra = larguraUtil / setores.length * 0.6;
    const espacamento = larguraUtil / setores.length;

    // Eixo Y
    ctx.strokeStyle = '#e5e8f0';
    ctx.beginPath();
    ctx.moveTo(margemEsquerda, margemSuperior);
    ctx.lineTo(margemEsquerda, canvas.height - margemInferior);
    ctx.lineTo(canvas.width - 10, canvas.height - margemInferior);
    ctx.stroke();

    setores.forEach(function (setor, indice) {
      const valor = totaisPorSetor[setor];
      const alturaBarra = valorMaximo > 0 ? (valor / valorMaximo) * alturaUtil : 0;
      const x = margemEsquerda + indice * espacamento + (espacamento - larguraBarra) / 2;
      const y = canvas.height - margemInferior - alturaBarra;

      ctx.fillStyle = '#2563eb';
      ctx.fillRect(x, y, larguraBarra, alturaBarra);

      ctx.fillStyle = '#1a2744';
      ctx.font = 'bold 12px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(valor, x + larguraBarra / 2, y - 6);

      ctx.fillStyle = '#6b7280';
      ctx.font = '11px Inter';
      ctx.fillText(setor, x + larguraBarra / 2, canvas.height - margemInferior + 16);
    });

    ctx.textAlign = 'left';
  }

  async function carregarRelatorioEstadia() {
    const data = document.getElementById('filtroDataEstadia').value;
    const corpoTabela = document.getElementById('corpoTabelaEstadia');
    const mediaCelula = document.getElementById('mediaEstadia');

    if (!data) {
      mostrarToast('Selecione a data do relatório.', 'erro');
      return;
    }

    try {
      const { dados } = await requisitarJson(`/api/relatorio/tempo-estadia?data=${data}`);

      if (!dados.sucesso) {
        corpoTabela.innerHTML = '<tr><td colspan="7" class="empty-state">Erro ao gerar relatório.</td></tr>';
        return;
      }

      if (!dados.dados.length) {
        corpoTabela.innerHTML = '<tr><td colspan="7" class="empty-state">Nenhum visitante encontrado nesta data.</td></tr>';
        mediaCelula.textContent = '00:00';
        return;
      }

      corpoTabela.innerHTML = dados.dados.map(function (linha) {
        const classeBadge = linha.saida === 'Em visita' ? 'badge badge-ativo' : '';
        const saidaHtml = linha.saida === 'Em visita' ? `<span class="${classeBadge}">Em visita</span>` : linha.saida;
        const fotoHtml = linha.foto_path
          ? `<img src="/static/${linha.foto_path}" class="foto-thumb" alt="Foto de ${linha.nome}">`
          : `<div class="foto-thumb foto-thumb-vazia"><i class="fa-solid fa-user"></i></div>`;
        return `
          <tr>
            <td>${fotoHtml}</td>
            <td>${linha.nome}</td>
            <td>${linha.empresa}</td>
            <td>${linha.setor}</td>
            <td>${linha.entrada}</td>
            <td>${saidaHtml}</td>
            <td>${linha.tempo_total}</td>
          </tr>
        `;
      }).join('');

      mediaCelula.textContent = dados.media;
    } catch (erro) {
      mostrarToast('Falha ao carregar o relatório de tempo de estadia.', 'erro');
    }
  }

  function exportarCsvEstadia() {
    const data = document.getElementById('filtroDataEstadia').value;
    if (!data) {
      mostrarToast('Selecione a data do relatório antes de exportar.', 'erro');
      return;
    }
    window.location.href = `/api/relatorio/tempo-estadia/csv?data=${data}`;
  }

  // ----------------------------------------------------------
  // PÁGINA: LOGIN (login.html)
  // ----------------------------------------------------------

  function inicializarPaginaLogin() {
    const form = document.getElementById('formLogin');
    if (!form) return;

    const alertaLogin = document.getElementById('alertaLogin');
    const btnLogin = document.getElementById('btnLogin');

    form.addEventListener('submit', async function (evento) {
      evento.preventDefault();
      alertaLogin.innerHTML = '';

      const dados = {
        login: document.getElementById('login').value.trim(),
        senha: document.getElementById('senha').value
      };

      btnLogin.disabled = true;
      btnLogin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Entrando...';

      try {
        const { status, dados: resposta } = await requisitarJson('/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dados)
        });

        if (status === 200 && resposta.sucesso) {
          window.location.href = resposta.redirect || '/';
        } else {
          alertaLogin.innerHTML = `<div class="alert alert-erro"><i class="fa-solid fa-circle-exclamation"></i> ${resposta.mensagem || 'Login ou senha inválidos.'}</div>`;
        }
      } catch (erro) {
        alertaLogin.innerHTML = '<div class="alert alert-erro"><i class="fa-solid fa-circle-exclamation"></i> Falha de comunicação com o servidor.</div>';
      } finally {
        btnLogin.disabled = false;
        btnLogin.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Entrar';
      }
    });
  }

  // ----------------------------------------------------------
  // PÁGINA: ADMINISTRAÇÃO (admin.html)
  // ----------------------------------------------------------

  function inicializarPaginaAdmin() {
    const formUsuario = document.getElementById('formUsuario');
    if (!formUsuario) return;

    inicializarAbasAdmin();
    inicializarSecaoUsuarios();
    inicializarSecaoSetoresAdmin();
  }

  function inicializarAbasAdmin() {
    const botoes = document.querySelectorAll('.admin-tab-btn');
    const paineis = document.querySelectorAll('.tab-pane');

    botoes.forEach(function (botao) {
      botao.addEventListener('click', function () {
        const aba = botao.dataset.tab;

        botoes.forEach(function (b) { b.classList.toggle('active', b === botao); });
        paineis.forEach(function (painel) {
          painel.classList.toggle('hidden', painel.dataset.tab !== aba);
        });
      });
    });
  }

  function inicializarSecaoUsuarios() {
    const formUsuario = document.getElementById('formUsuario');
    const btnCancelarUsuario = document.getElementById('btnCancelarUsuario');

    carregarUsuarios();

    formUsuario.addEventListener('submit', salvarUsuario);
    btnCancelarUsuario.addEventListener('click', resetarFormularioUsuario);
  }

  function resetarFormularioUsuario() {
    document.getElementById('usuario_id').value = '';
    document.getElementById('formUsuario').reset();
    document.getElementById('usuario_permissao').value = 'operador';
    document.getElementById('senhaObrigatoria').style.display = 'inline';
    document.getElementById('senhaAjuda').textContent = 'Obrigatória para novos usuários.';
    document.getElementById('usuario_senha').required = true;
    document.getElementById('btnSalvarUsuario').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Cadastrar Usuário';
    document.getElementById('btnCancelarUsuario').style.display = 'none';
  }

  async function carregarUsuarios() {
    const corpoTabela = document.getElementById('corpoTabelaUsuarios');
    try {
      const { dados } = await requisitarJson('/api/usuarios');

      if (!dados.sucesso) {
        corpoTabela.innerHTML = '<tr><td colspan="5" class="empty-state">Erro ao carregar usuários.</td></tr>';
        return;
      }

      if (!dados.usuarios.length) {
        corpoTabela.innerHTML = '<tr><td colspan="5" class="empty-state">Nenhum usuário cadastrado.</td></tr>';
        return;
      }

      const rotulosPermissao = { admin: 'Administrador', operador: 'Operador', visualizador: 'Visualizador' };

      corpoTabela.innerHTML = dados.usuarios.map(function (usuario) {
        return `
          <tr data-id="${usuario.id}">
            <td>${usuario.nome}</td>
            <td>${usuario.login}</td>
            <td><span class="badge badge-${usuario.permissao}">${rotulosPermissao[usuario.permissao] || usuario.permissao}</span></td>
            <td>${usuario.criado_em}</td>
            <td>
              <button class="btn btn-secondary btn-sm btn-editar-usuario" data-id="${usuario.id}" data-nome="${usuario.nome}" data-login="${usuario.login}" data-permissao="${usuario.permissao}">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn btn-secondary btn-sm btn-excluir-usuario" data-id="${usuario.id}">
                <i class="fa-solid fa-trash"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      document.querySelectorAll('.btn-editar-usuario').forEach(function (botao) {
        botao.addEventListener('click', function () {
          document.getElementById('usuario_id').value = botao.dataset.id;
          document.getElementById('usuario_nome').value = botao.dataset.nome;
          document.getElementById('usuario_login').value = botao.dataset.login;
          document.getElementById('usuario_permissao').value = botao.dataset.permissao;
          document.getElementById('usuario_senha').value = '';
          document.getElementById('usuario_senha').required = false;
          document.getElementById('senhaObrigatoria').style.display = 'none';
          document.getElementById('senhaAjuda').textContent = 'Deixe em branco para manter a senha atual.';
          document.getElementById('btnSalvarUsuario').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar Alterações';
          document.getElementById('btnCancelarUsuario').style.display = 'inline-flex';
          document.getElementById('usuario_nome').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });

      document.querySelectorAll('.btn-excluir-usuario').forEach(function (botao) {
        botao.addEventListener('click', function () {
          excluirUsuario(botao.dataset.id);
        });
      });
    } catch (erro) {
      corpoTabela.innerHTML = '<tr><td colspan="5" class="empty-state">Falha de comunicação com o servidor.</td></tr>';
    }
  }

  async function salvarUsuario(evento) {
    evento.preventDefault();

    const alertaUsuario = document.getElementById('alertaUsuario');
    alertaUsuario.innerHTML = '';

    const id = document.getElementById('usuario_id').value;
    const dados = {
      nome: document.getElementById('usuario_nome').value.trim(),
      login: document.getElementById('usuario_login').value.trim(),
      senha: document.getElementById('usuario_senha').value,
      permissao: document.getElementById('usuario_permissao').value
    };

    try {
      const url = id ? `/api/usuarios/${id}` : '/api/usuarios';
      const metodo = id ? 'PUT' : 'POST';

      const { status, dados: resposta } = await requisitarJson(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });

      if (status === 200 && resposta.sucesso) {
        mostrarToast(resposta.mensagem, 'sucesso');
        resetarFormularioUsuario();
        carregarUsuarios();
      } else {
        alertaUsuario.innerHTML = `<div class="alert alert-erro"><i class="fa-solid fa-circle-exclamation"></i> ${resposta.mensagem}</div>`;
      }
    } catch (erro) {
      alertaUsuario.innerHTML = '<div class="alert alert-erro"><i class="fa-solid fa-circle-exclamation"></i> Falha de comunicação com o servidor.</div>';
    }
  }

  async function excluirUsuario(id) {
    try {
      const { status, dados } = await requisitarJson(`/api/usuarios/${id}`, { method: 'DELETE' });
      if (status === 200 && dados.sucesso) {
        mostrarToast(dados.mensagem, 'sucesso');
        carregarUsuarios();
      } else {
        mostrarToast(dados.mensagem || 'Não foi possível excluir o usuário.', 'erro');
      }
    } catch (erro) {
      mostrarToast('Falha de comunicação com o servidor.', 'erro');
    }
  }

  function inicializarSecaoSetoresAdmin() {
    const formSetor = document.getElementById('formSetor');
    const btnCancelarSetor = document.getElementById('btnCancelarSetor');

    carregarSetoresAdmin();

    formSetor.addEventListener('submit', salvarSetorAdmin);
    btnCancelarSetor.addEventListener('click', resetarFormularioSetor);
  }

  function resetarFormularioSetor() {
    document.getElementById('setor_id').value = '';
    document.getElementById('formSetor').reset();
    document.getElementById('btnSalvarSetor').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Cadastrar Setor';
    document.getElementById('btnCancelarSetor').style.display = 'none';
  }

  async function carregarSetoresAdmin() {
    const corpoTabela = document.getElementById('corpoTabelaSetoresAdmin');
    try {
      const { dados } = await requisitarJson('/api/setores');

      if (!dados.sucesso) {
        corpoTabela.innerHTML = '<tr><td colspan="2" class="empty-state">Erro ao carregar setores.</td></tr>';
        return;
      }

      if (!dados.setores.length) {
        corpoTabela.innerHTML = '<tr><td colspan="2" class="empty-state">Nenhum setor cadastrado.</td></tr>';
        return;
      }

      corpoTabela.innerHTML = dados.setores.map(function (setor) {
        return `
          <tr data-id="${setor.id}">
            <td>${setor.nome}</td>
            <td>
              <button class="btn btn-secondary btn-sm btn-editar-setor" data-id="${setor.id}" data-nome="${setor.nome}">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="btn btn-secondary btn-sm btn-excluir-setor" data-id="${setor.id}">
                <i class="fa-solid fa-trash"></i>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      document.querySelectorAll('.btn-editar-setor').forEach(function (botao) {
        botao.addEventListener('click', function () {
          document.getElementById('setor_id').value = botao.dataset.id;
          document.getElementById('setor_nome').value = botao.dataset.nome;
          document.getElementById('btnSalvarSetor').innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar Alterações';
          document.getElementById('btnCancelarSetor').style.display = 'inline-flex';
          document.getElementById('setor_nome').scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });

      document.querySelectorAll('.btn-excluir-setor').forEach(function (botao) {
        botao.addEventListener('click', function () {
          excluirSetorAdmin(botao.dataset.id);
        });
      });
    } catch (erro) {
      corpoTabela.innerHTML = '<tr><td colspan="2" class="empty-state">Falha de comunicação com o servidor.</td></tr>';
    }
  }

  async function salvarSetorAdmin(evento) {
    evento.preventDefault();

    const alertaSetor = document.getElementById('alertaSetor');
    alertaSetor.innerHTML = '';

    const id = document.getElementById('setor_id').value;
    const dados = { nome: document.getElementById('setor_nome').value.trim() };

    try {
      const url = id ? `/api/setores/${id}` : '/api/setores';
      const metodo = id ? 'PUT' : 'POST';

      const { status, dados: resposta } = await requisitarJson(url, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });

      if (status === 200 && resposta.sucesso) {
        mostrarToast(resposta.mensagem, 'sucesso');
        resetarFormularioSetor();
        carregarSetoresAdmin();
      } else {
        alertaSetor.innerHTML = `<div class="alert alert-erro"><i class="fa-solid fa-circle-exclamation"></i> ${resposta.mensagem}</div>`;
      }
    } catch (erro) {
      alertaSetor.innerHTML = '<div class="alert alert-erro"><i class="fa-solid fa-circle-exclamation"></i> Falha de comunicação com o servidor.</div>';
    }
  }

  async function excluirSetorAdmin(id) {
    try {
      const { status, dados } = await requisitarJson(`/api/setores/${id}`, { method: 'DELETE' });
      if (status === 200 && dados.sucesso) {
        mostrarToast(dados.mensagem, 'sucesso');
        carregarSetoresAdmin();
      } else {
        mostrarToast(dados.mensagem || 'Não foi possível excluir o setor.', 'erro');
      }
    } catch (erro) {
      mostrarToast('Falha de comunicação com o servidor.', 'erro');
    }
  }

  // ----------------------------------------------------------
  // INICIALIZAÇÃO GERAL (executa em todas as páginas)
  // ----------------------------------------------------------

  document.addEventListener('DOMContentLoaded', inicializarSidebar);

  return {
    inicializarPaginaCadastro: inicializarPaginaCadastro,
    inicializarPaginaEtiqueta: inicializarPaginaEtiqueta,
    inicializarPaginaSaida: inicializarPaginaSaida,
    inicializarPaginaRelatorios: inicializarPaginaRelatorios,
    inicializarPaginaLogin: inicializarPaginaLogin,
    inicializarPaginaAdmin: inicializarPaginaAdmin
  };

})();
