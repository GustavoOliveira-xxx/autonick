/** Notificações persistentes dentro do app (E08). Sem e-mail, SMS ou push: só o que o banco registrou para esta pessoa. */
import { neon } from './sessao.js';

export const minhasNotificacoes = (antes = null, limite = 20) => neon.rpc('minhas_notificacoes', { p_antes: antes, p_limite: limite });
export const marcarLidas = (ids = null) => neon.rpc('marcar_notificacoes_lidas', { p_ids: ids });
export const preferencias = () => neon.rpc('preferencias_notificacao', {});
export const definirPreferencia = (tipo, ativa) => neon.rpc('definir_preferencia_notificacao', { p_tipo: tipo, p_ativa: ativa });
export const meuOnboarding = () => neon.rpc('meu_onboarding', {});
export const dispensarOnboarding = (chave) => neon.rpc('dispensar_onboarding', { p_chave: chave });
export const reiniciarOnboarding = () => neon.rpc('reiniciar_onboarding', {});
export const TIPOS_NOTIFICACAO = { pedido: 'Pedidos', orcamento: 'Orçamentos e solicitações', os: 'Ordens de serviço', estoque: 'Aprovações de estoque' };
