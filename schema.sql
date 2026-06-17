-- ============================================================
-- Banco de dados: Controle de Acesso de Visitantes - INGOH
-- ============================================================

CREATE DATABASE IF NOT EXISTS controle_visitantes CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE controle_visitantes;

-- Tabela de visitantes
CREATE TABLE IF NOT EXISTS visitantes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  cpf VARCHAR(14) NOT NULL,
  data_nascimento DATE NOT NULL,
  empresa VARCHAR(150),
  telefone VARCHAR(20),
  setor_visita VARCHAR(100) NOT NULL,
  pessoa_visita VARCHAR(150) NOT NULL,
  hora_entrada DATETIME DEFAULT CURRENT_TIMESTAMP,
  hora_saida DATETIME NULL,
  status ENUM('ativo','encerrado') DEFAULT 'ativo',
  encerrado_automatico TINYINT(1) DEFAULT 0,
  INDEX idx_status_data (status, hora_entrada),
  INDEX idx_cpf (cpf)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabela de setores
CREATE TABLE IF NOT EXISTS setores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Setores padrão
INSERT INTO setores (nome) VALUES
('TI'),('RH'),('Financeiro'),('Comercial'),('Diretoria'),('Operações'),('Recepção');

-- Tabela de usuários do painel administrativo
CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  login VARCHAR(60) NOT NULL UNIQUE,
  senha_hash VARCHAR(255) NOT NULL,
  permissao ENUM('admin','operador','visualizador') NOT NULL DEFAULT 'operador',
  criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Usuário administrador padrão (login: admin / senha: admin123)
-- IMPORTANTE: altere essa senha pelo próprio painel /admin após o primeiro acesso.
INSERT IGNORE INTO usuarios (nome, login, senha_hash, permissao) VALUES
('Administrador', 'admin', 'scrypt:32768:8:1$yzGBaRodaEzNaPqv$423d1c29a74953a2cbff2469ff2e6b6aea7959f0e0470428ebdc4116385ee94c8569ef68010353929043638a89e74705634c3b9660820a338d827c56bd52d9be', 'admin');

-- Usuário de aplicação (ajuste a senha conforme o .env)
-- CREATE USER 'visitante_app'@'localhost' IDENTIFIED BY 'SuaSenhaForte123!';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON controle_visitantes.* TO 'visitante_app'@'localhost';
-- FLUSH PRIVILEGES;
