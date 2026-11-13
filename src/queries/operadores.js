import { db } from '../lib/db.js'
import {
  ensureAuthSchema,
  validarSessaoServidor,
  assertPermissao,
  registrarAuditoriaAcesso,
  limparCacheSessao,
} from '../lib/authGuard.js'
import { hashSenha, verificarSenha, gerarTokenSessao } from '../utils/authCrypto.js'
import {
  isMaster,
  sanitizarPermissoes,
  PERFIS_SISTEMA_BASE,
  PERMISSOES_MASTER_COMPLETAS,
} from '../utils/permissoes.js'

function formatarOperadorLimpo(row) {
  const nivel = String(row.nivel || (Number(row.is_adm) === 1 ? 'ADMINISTRADOR' : 'OPERACIONAL')).toUpperCase()
  const perfil = String(row.perfil || nivel).toUpperCase()
  return {
    id: Number(row.id),
    nome: row.nome,
    login: row.login || row.nome,
    perfil,
    nivel,
    setor: row.setor || 'Produção',
    is_adm: nivel === 'MASTER' || nivel === 'ADMINISTRADOR' || Number(row.is_adm) === 1 ? 1 : 0,
    ativo: Number(row.ativo ?? 1),
    deve_trocar_senha: Number(row.deve_trocar_senha || 0),
    permissoes: sanitizarPermissoes(row.permissoes, nivel, perfil),
    ultimo_acesso: row.ultimo_acesso || null,
    criado_por_nome: row.criado_por_nome || null,
    atualizado_por_nome: row.atualizado_por_nome || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }
}

export async function autenticar() {
  return { success: false, error: 'Acesso por PIN anônimo desativado. Utilize usuário (login) e senha.' }
}

/**
 * Autenticação segura por usuário (login) e senha com geração de sessão no banco.
 */
export async function autenticarComSenha(login, senha) {
  await ensureAuthSchema()
  const cleanLogin = String(login || '').trim()
  const cleanSenha = String(senha ?? '')

  if (!cleanLogin || !cleanSenha) {
    return { success: false, error: 'Informe o usuário (login) e a senha.' }
  }

  const res = await db.execute({
    sql: `
      SELECT id, nome, login, senha_hash, perfil, nivel, setor, is_adm, ativo, deve_trocar_senha, permissoes, ultimo_acesso
      FROM operadores
      WHERE LOWER(COALESCE(login, '')) = LOWER(?)
      LIMIT 1
    `,
    args: [cleanLogin],
  })

  const row = res.rows[0]
  if (!row) {
    return { success: false, error: 'Usuário ou senha incorretos.' }
  }

  if (Number(row.ativo) !== 1) {
    return { success: false, error: 'Esta conta está desativada. Procure o administrador.' }
  }

  const senhaValida = await verificarSenha(cleanSenha, row.senha_hash)
  if (!senhaValida) {
    return { success: false, error: 'Usuário ou senha incorretos.' }
  }

  const token = gerarTokenSessao()
  await db.execute({
    sql: `INSERT INTO sessoes_usuarios (operador_id, token, ativo) VALUES (?, ?, 1)`,
    args: [Number(row.id), token],
  })
  await db.execute({
    sql: `UPDATE operadores SET ultimo_acesso = CURRENT_TIMESTAMP WHERE id = ?`,
    args: [Number(row.id)],
  })

  const operador = formatarOperadorLimpo(row)
  limparCacheSessao()

  await registrarAuditoriaAcesso({
    targetUserId: operador.id,
    targetUserNome: operador.nome,
    acao: 'LOGIN',
    detalhesDepois: { login: operador.login, nivel: operador.nivel, setor: operador.setor },
    executor: operador,
  })

  return { success: true, operador, token }
}

export async function encerrarSessao(token) {
  if (!token) return
  try {
    await db.execute({
      sql: `UPDATE sessoes_usuarios SET ativo = 0, encerrada_em = CURRENT_TIMESTAMP WHERE token = ?`,
      args: [token],
    })
  } catch { /* ignore */ }
  limparCacheSessao()
}

export async function trocarPropriaSenha({ senhaAtual, novaSenha }) {
  const op = await validarSessaoServidor({ forceFresh: true })
  if (!isMaster(op) && op.permissoes?.alterar_propria_senha === false && op.deve_trocar_senha !== 1) {
    throw new Error('Seu usuário não está autorizado a alterar a própria senha. Solicite ao administrador.')
  }

  const nova = String(novaSenha ?? '')
  if (nova.length < 4) {
    throw new Error('A nova senha deve possuir pelo menos 4 caracteres.')
  }
  if (nova === String(senhaAtual ?? '')) {
    throw new Error('A nova senha deve ser diferente da senha atual.')
  }

  const res = await db.execute({
    sql: `SELECT senha_hash FROM operadores WHERE id = ? LIMIT 1`,
    args: [op.id],
  })
  const ok = await verificarSenha(String(senhaAtual ?? ''), res.rows[0]?.senha_hash)
  if (!ok) {
    throw new Error('Senha atual incorreta.')
  }

  const novoHash = await hashSenha(nova)
  await db.execute({
    sql: `
      UPDATE operadores
      SET senha_hash = ?,
          pin = '****',
          deve_trocar_senha = 0,
          atualizado_por_nome = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    args: [novoHash, op.nome, op.id],
  })

  limparCacheSessao()
  const atualizado = await validarSessaoServidor({ forceFresh: true })

  await registrarAuditoriaAcesso({
    targetUserId: op.id,
    targetUserNome: op.nome,
    acao: 'TROCA_PROPRIA_SENHA',
    detalhesDepois: { deve_trocar_senha: 0 },
    executor: atualizado,
  })

  return atualizado
}

export async function listar() {
  await assertPermissao('operadores', { write: false })
  const res = await db.execute(`
    SELECT id, nome, login, perfil, nivel, setor, is_adm, ativo, deve_trocar_senha,
           permissoes, ultimo_acesso, criado_por_nome, atualizado_por_nome, created_at, updated_at
    FROM operadores
    ORDER BY
      CASE
        WHEN UPPER(COALESCE(nivel,'')) = 'MASTER' THEN 0
        WHEN UPPER(COALESCE(nivel,'')) = 'ADMINISTRADOR' THEN 1
        WHEN UPPER(COALESCE(nivel,'')) = 'OPERACIONAL' THEN 2
        ELSE 3
      END ASC,
      nome ASC
  `)
  return res.rows.map(formatarOperadorLimpo)
}

export async function criar({
  nome,
  login,
  senha,
  setor = 'Produção',
  perfil = 'OPERADOR',
  nivel = 'OPERACIONAL',
  permissoes = {},
  deve_trocar_senha = false,
  ativo = 1,
}) {
  const executor = await assertPermissao('operadores', { forceFresh: true })

  const cleanNome = String(nome || '').trim()
  const cleanLogin = String(login || '').trim()
  const cleanSenha = String(senha ?? '')
  const nivelUp = String(nivel || 'OPERACIONAL').toUpperCase()
  const perfilUp = String(perfil || nivelUp).toUpperCase()

  if (!cleanNome) return { success: false, error: 'Informe o nome completo do usuário.' }
  if (!cleanLogin) return { success: false, error: 'Informe o nome de usuário (login).' }
  if (cleanSenha.length < 4) return { success: false, error: 'A senha deve conter no mínimo 4 caracteres.' }

  if ((nivelUp === 'MASTER' || perfilUp === 'MASTER') && !isMaster(executor)) {
    return { success: false, error: 'Apenas um usuário MASTER pode criar outro usuário MASTER.' }
  }

  const dup = await db.execute({
    sql: `SELECT id FROM operadores WHERE LOWER(COALESCE(login,'')) = LOWER(?) LIMIT 1`,
    args: [cleanLogin],
  })
  if (dup.rows.length > 0) {
    return { success: false, error: `Já existe um usuário cadastrado com o login "${cleanLogin}".` }
  }

  const senhaHash = await hashSenha(cleanSenha)
  const permsSan = sanitizarPermissoes(permissoes, nivelUp, perfilUp)
  const isAdmFlag = nivelUp === 'MASTER' || nivelUp === 'ADMINISTRADOR' ? 1 : 0

  const result = await db.execute({
    sql: `
      INSERT INTO operadores (
        nome, login, pin, senha_hash, perfil, nivel, setor, is_adm, ativo,
        deve_trocar_senha, permissoes, criado_por_nome, atualizado_por_nome, created_at, updated_at
      ) VALUES (?, ?, '****', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    args: [
      cleanNome,
      cleanLogin,
      senhaHash,
      perfilUp,
      nivelUp,
      String(setor || (nivelUp === 'CLIENTE' ? 'CLIENTE' : 'Produção')).trim(),
      isAdmFlag,
      Number(ativo) === 0 ? 0 : 1,
      deve_trocar_senha ? 1 : 0,
      JSON.stringify(permsSan),
      executor.nome,
      executor.nome,
    ],
  })

  const novoId = Number(result.lastInsertRowid)
  await registrarAuditoriaAcesso({
    targetUserId: novoId,
    targetUserNome: cleanNome,
    acao: 'CRIACAO_USUARIO',
    detalhesDepois: {
      login: cleanLogin,
      setor,
      perfil: perfilUp,
      nivel: nivelUp,
      ativo: Number(ativo) === 0 ? 0 : 1,
      permissoes: permsSan,
    },
    executor,
  })

  return { success: true, id: String(novoId) }
}

export async function atualizar({
  id,
  nome,
  login,
  setor,
  perfil,
  nivel,
  permissoes,
  ativo,
  novaSenha = '',
  deve_trocar_senha,
}) {
  const executor = await assertPermissao('operadores', { forceFresh: true })
  const targetId = Number(id)

  const antesRes = await db.execute({
    sql: `SELECT * FROM operadores WHERE id = ? LIMIT 1`,
    args: [targetId],
  })
  const antesRow = antesRes.rows[0]
  if (!antesRow) return { success: false, error: 'Usuário não encontrado.' }

  const antes = formatarOperadorLimpo(antesRow)
  if (antes.nivel === 'MASTER' && !isMaster(executor)) {
    return { success: false, error: 'Somente um usuário MASTER pode alterar a conta MASTER.' }
  }

  const nivelFinal = String(nivel || antes.nivel).toUpperCase()
  const perfilFinal = String(perfil || nivelFinal).toUpperCase()

  if ((nivelFinal === 'MASTER' || perfilFinal === 'MASTER') && !isMaster(executor)) {
    return { success: false, error: 'Somente o usuário MASTER pode atribuir nível MASTER.' }
  }

  const cleanNome = String(nome || antes.nome).trim()
  const cleanLogin = String(login || antes.login).trim()
  if (!cleanNome || !cleanLogin) {
    return { success: false, error: 'Nome e login são obrigatórios.' }
  }

  const dup = await db.execute({
    sql: `SELECT id FROM operadores WHERE LOWER(COALESCE(login,'')) = LOWER(?) AND id != ? LIMIT 1`,
    args: [cleanLogin, targetId],
  })
  if (dup.rows.length > 0) {
    return { success: false, error: `O login "${cleanLogin}" já está sendo usado por outro usuário.` }
  }

  // MASTER não pode ser desativado nem rebaixado de ativo=1
  const ativoFinal = antes.nivel === 'MASTER' ? 1 : (ativo === undefined ? antes.ativo : (Number(ativo) === 1 ? 1 : 0))
  const nivelProtected = antes.nivel === 'MASTER' ? 'MASTER' : nivelFinal
  const perfilProtected = antes.nivel === 'MASTER' ? 'MASTER' : perfilFinal
  const permsSan = sanitizarPermissoes(permissoes ?? antes.permissoes, nivelProtected, perfilProtected)
  const isAdmFlag = nivelProtected === 'MASTER' || nivelProtected === 'ADMINISTRADOR' ? 1 : 0

  let senhaHashSql = ''
  const args = [
    cleanNome,
    cleanLogin,
    perfilProtected,
    nivelProtected,
    String(setor || antes.setor).trim(),
    isAdmFlag,
    ativoFinal,
    deve_trocar_senha === undefined ? antes.deve_trocar_senha : (deve_trocar_senha ? 1 : 0),
    JSON.stringify(permsSan),
    executor.nome,
  ]

  if (novaSenha && String(novaSenha).trim().length > 0) {
    if (String(novaSenha).trim().length < 4) {
      return { success: false, error: 'A nova senha deve conter no mínimo 4 caracteres.' }
    }
    const h = await hashSenha(String(novaSenha).trim())
    senhaHashSql = ', senha_hash = ?'
    args.push(h)
  }

  args.push(targetId)

  await db.execute({
    sql: `
      UPDATE operadores
      SET nome = ?,
          login = ?,
          pin = '****',
          perfil = ?,
          nivel = ?,
          setor = ?,
          is_adm = ?,
          ativo = ?,
          deve_trocar_senha = ?,
          permissoes = ?,
          atualizado_por_nome = ?,
          updated_at = CURRENT_TIMESTAMP
          ${senhaHashSql}
      WHERE id = ?
    `,
    args,
  })

  if (ativoFinal === 0) {
    await db.execute({
      sql: `UPDATE sessoes_usuarios SET ativo = 0, encerrada_em = CURRENT_TIMESTAMP WHERE operador_id = ? AND ativo = 1`,
      args: [targetId],
    })
  }
  limparCacheSessao()

  await registrarAuditoriaAcesso({
    targetUserId: targetId,
    targetUserNome: cleanNome,
    acao: 'EDICAO_USUARIO_PERMISSOES',
    detalhesAntes: {
      nome: antes.nome,
      login: antes.login,
      setor: antes.setor,
      perfil: antes.perfil,
      nivel: antes.nivel,
      ativo: antes.ativo,
      permissoes: antes.permissoes,
    },
    detalhesDepois: {
      nome: cleanNome,
      login: cleanLogin,
      setor,
      perfil: perfilProtected,
      nivel: nivelProtected,
      ativo: ativoFinal,
      permissoes: permsSan,
      senhaAlterada: Boolean(senhaHashSql),
    },
    executor,
  })

  return { success: true }
}

export async function redefinirSenha({ id, novaSenha, exigirTroca = true }) {
  const executor = await assertPermissao(['redefinir_senhas', 'operadores'], { forceFresh: true })
  const targetId = Number(id)

  const targetRes = await db.execute({
    sql: `SELECT id, nome, login, nivel, perfil FROM operadores WHERE id = ? LIMIT 1`,
    args: [targetId],
  })
  const target = targetRes.rows[0]
  if (!target) throw new Error('Usuário não encontrado.')

  if (String(target.nivel || '').toUpperCase() === 'MASTER' && !isMaster(executor)) {
    throw new Error('Somente o usuário MASTER pode redefinir a senha da conta MASTER.')
  }
  const cleanSenha = String(novaSenha ?? '')
  if (cleanSenha.length < 4) {
    throw new Error('A senha deve possuir pelo menos 4 caracteres.')
  }

  const hash = await hashSenha(cleanSenha)
  await db.execute({
    sql: `
      UPDATE operadores
      SET senha_hash = ?,
          pin = '****',
          deve_trocar_senha = ?,
          atualizado_por_nome = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    args: [hash, exigirTroca ? 1 : 0, executor.nome, targetId],
  })

  // Encerra sessões ativas antigas ao redefinir senha de terceiros
  if (Number(targetId) !== Number(executor.id)) {
    await db.execute({
      sql: `UPDATE sessoes_usuarios SET ativo = 0, encerrada_em = CURRENT_TIMESTAMP WHERE operador_id = ? AND ativo = 1`,
      args: [targetId],
    })
  }
  limparCacheSessao()

  await registrarAuditoriaAcesso({
    targetUserId: targetId,
    targetUserNome: target.nome,
    acao: 'REDEFINICAO_SENHA',
    detalhesDepois: { exigir_troca_proximo_login: Boolean(exigirTroca) },
    executor,
  })

  return { success: true }
}

export async function alternarStatus(id, novoAtivo) {
  const executor = await assertPermissao('operadores', { forceFresh: true })
  const targetId = Number(id)

  const targetRes = await db.execute({
    sql: `SELECT id, nome, login, nivel, ativo FROM operadores WHERE id = ? LIMIT 1`,
    args: [targetId],
  })
  const target = targetRes.rows[0]
  if (!target) throw new Error('Usuário não encontrado.')

  if (String(target.nivel || '').toUpperCase() === 'MASTER') {
    throw new Error('A conta MASTER não pode ser desativada.')
  }
  if (targetId === Number(executor.id)) {
    throw new Error('Você não pode desativar o próprio usuário enquanto estiver logado.')
  }

  const statusVal = Number(novoAtivo) === 1 ? 1 : 0
  await db.execute({
    sql: `UPDATE operadores SET ativo = ?, atualizado_por_nome = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    args: [statusVal, executor.nome, targetId],
  })

  if (statusVal === 0) {
    await db.execute({
      sql: `UPDATE sessoes_usuarios SET ativo = 0, encerrada_em = CURRENT_TIMESTAMP WHERE operador_id = ? AND ativo = 1`,
      args: [targetId],
    })
  }
  limparCacheSessao()

  await registrarAuditoriaAcesso({
    targetUserId: targetId,
    targetUserNome: target.nome,
    acao: statusVal === 1 ? 'ATIVACAO_USUARIO' : 'DESATIVACAO_USUARIO',
    detalhesAntes: { ativo: Number(target.ativo) },
    detalhesDepois: { ativo: statusVal },
    executor,
  })

  return { success: true, ativo: statusVal }
}

export async function desativar(id) {
  return alternarStatus(id, 0)
}

export async function excluirUsuario(id) {
  const executor = await assertPermissao('operadores', { forceFresh: true })
  if (!isMaster(executor)) {
    throw new Error('A exclusão definitiva de usuários é permitida apenas ao usuário MASTER. Utilize desativação para preservar o histórico.')
  }
  const targetId = Number(id)
  const targetRes = await db.execute({
    sql: `SELECT id, nome, login, nivel FROM operadores WHERE id = ? LIMIT 1`,
    args: [targetId],
  })
  const target = targetRes.rows[0]
  if (!target) throw new Error('Usuário não encontrado.')
  if (String(target.nivel || '').toUpperCase() === 'MASTER') {
    throw new Error('A conta MASTER não pode ser excluída.')
  }

  await db.execute({
    sql: `UPDATE sessoes_usuarios SET ativo = 0, encerrada_em = CURRENT_TIMESTAMP WHERE operador_id = ?`,
    args: [targetId],
  })

  try {
    await db.execute({ sql: `DELETE FROM operadores WHERE id = ?`, args: [targetId] })
  } catch (err) {
    throw new Error('Este usuário já possui registros históricos vinculados e não pode ser apagado fisicamente; desative a conta.')
  }

  await registrarAuditoriaAcesso({
    targetUserId: targetId,
    targetUserNome: target.nome,
    acao: 'EXCLUSAO_USUARIO',
    detalhesAntes: { login: target.login, nivel: target.nivel },
    executor,
  })

  return { success: true }
}

// ─── Perfis Predefinidos por Setor ────────────────────────────────────────────

export async function listarPerfis() {
  await assertPermissao(['operadores', 'perfis_gerenciar'], { write: false })
  const res = await db.execute(`
    SELECT id, codigo, nome, nivel, setor_padrao, descricao, permissoes_json, sistema_fixo, created_at, updated_at
    FROM perfis_acesso
    ORDER BY sistema_fixo DESC, nome ASC
  `)
  return res.rows.map((r) => {
    let perms = {}
    try { perms = JSON.parse(r.permissoes_json || '{}') } catch {}
    return {
      ...r,
      permissoes: sanitizarPermissoes(perms, r.nivel, r.codigo),
    }
  })
}

export async function salvarPerfil({ codigo, nome, nivel, setor_padrao, descricao, permissoes }) {
  const executor = await assertPermissao('perfis_gerenciar', { forceFresh: true })
  const cod = String(codigo || nome || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (!cod || !nome?.trim()) throw new Error('Informe código e nome do perfil.')
  if (cod === 'MASTER') throw new Error('O perfil MASTER do sistema é irrestrito e não pode ser alterado.')

  const nivelFinal = String(nivel || 'OPERACIONAL').toUpperCase()
  if (nivelFinal === 'MASTER' && !isMaster(executor)) {
    throw new Error('Apenas o usuário MASTER pode configurar perfil de nível MASTER.')
  }

  const permsSan = sanitizarPermissoes(permissoes, nivelFinal, cod)
  await db.execute({
    sql: `
      INSERT INTO perfis_acesso (codigo, nome, nivel, setor_padrao, descricao, permissoes_json, sistema_fixo, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
      ON CONFLICT(codigo) DO UPDATE SET
        nome = excluded.nome,
        nivel = excluded.nivel,
        setor_padrao = excluded.setor_padrao,
        descricao = excluded.descricao,
        permissoes_json = excluded.permissoes_json,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [cod, nome.trim().toUpperCase(), nivelFinal, setor_padrao || 'Produção', descricao || '', JSON.stringify(permsSan)],
  })

  await registrarAuditoriaAcesso({
    targetUserNome: `Perfil ${nome.trim()}`,
    acao: 'SALVAR_PERFIL_ACESSO',
    detalhesDepois: { codigo: cod, nivel: nivelFinal, setor_padrao, permissoes: permsSan },
    executor,
  })

  return { success: true, codigo: cod }
}

export async function excluirPerfil(codigo) {
  const executor = await assertPermissao('perfis_gerenciar', { forceFresh: true })
  const res = await db.execute({
    sql: `SELECT codigo, nome, sistema_fixo FROM perfis_acesso WHERE codigo = ? LIMIT 1`,
    args: [codigo],
  })
  if (res.rows.length === 0) throw new Error('Perfil não encontrado.')
  if (Number(res.rows[0].sistema_fixo) === 1) {
    throw new Error('Perfis nativos do sistema (OPERADOR, CLIENTE, ADMINISTRADOR, MASTER) não podem ser excluídos.')
  }
  await db.execute({ sql: `DELETE FROM perfis_acesso WHERE codigo = ?`, args: [codigo] })
  await registrarAuditoriaAcesso({
    targetUserNome: `Perfil ${res.rows[0].nome}`,
    acao: 'EXCLUSAO_PERFIL_ACESSO',
    detalhesAntes: { codigo },
    executor,
  })
  return { success: true }
}

export async function listarAuditoria(limite = 100) {
  await assertPermissao('operadores', { write: false })
  const res = await db.execute({
    sql: `
      SELECT id, target_user_id, target_user_nome, acao, detalhes_antes, detalhes_depois,
             executor_id, executor_nome, created_at
      FROM auditoria_acessos
      ORDER BY id DESC
      LIMIT ?
    `,
    args: [Number(limite) || 100],
  })
  return res.rows
}

export const operadoresQueries = {
  autenticar,
  autenticarComSenha,
  encerrarSessao,
  trocarPropriaSenha,
  listar,
  criar,
  atualizar,
  redefinirSenha,
  alternarStatus,
  desativar,
  excluirUsuario,
  listarPerfis,
  salvarPerfil,
  excluirPerfil,
  listarAuditoria,
}

