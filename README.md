# Ministério das Finanças (versão com login e nuvem)

App de controle financeiro em HTML, CSS e JavaScript puros, sem etapa de build. Os dados ficam no Supabase
(projeto `ministerio-das-financas`) e cada pessoa só enxerga o que é dela.

## Publicar no Vercel

**Pelo GitHub (recomendado)**
1. Crie um repositório e envie o conteúdo desta pasta (a raiz do repositório deve ter o `index.html`).
2. No Vercel: Add New, Project, importe o repositório.
3. Framework Preset: **Other**. Deixe Build Command e Output Directory em branco. Clique em Deploy.

**Pelo terminal**
```
npm i -g vercel
cd ministerio-das-financas-vercel
vercel --prod
```

## Configurar o Supabase (uma vez, depois de publicar)
No painel do projeto, em **Authentication, URL Configuration**:
- **Site URL**: o endereço do seu app no Vercel (por exemplo `https://seu-app.vercel.app`).
- **Redirect URLs**: o mesmo endereço.

Sem isso, os links de confirmação de e-mail e de redefinição de senha apontam para o lugar errado.
Em **Authentication, Providers, Email**, você pode desativar "Confirm email" se quiser entrar logo após criar a conta.

## Trazer os dados da versão que salva só no navegador
Na versão antiga: Ajustes, Exportar tudo, copie o texto.
Na nova: entre com sua conta, Ajustes, Importar, cole o texto. Cada perfil vira um perfil novo, com o sufixo "(importado)".

## Arquivos
- `index.html`, `styles.css`, `app.js`: o app.
- `config.js`: endereço e chave pública do Supabase. A chave pode ficar no navegador, quem protege os dados são as regras de acesso do banco.
- `vendor/supabase.js`: biblioteca supabase-js 2.117.1 incluída no projeto, sem depender de CDN.
- `vercel.json`: cabeçalhos de segurança (política de conteúdo restrita ao seu domínio e ao Supabase).

## Como a sincronização funciona
O app guarda uma cópia dos dados na tela e, a cada alteração, envia ao Supabase só o que mudou. O botão no topo mostra
"Salvando…", "Salvo na nuvem" ou "Erro ao sincronizar" (clique para tentar de novo). Ao voltar para a aba, os dados
são atualizados com o que foi feito em outros aparelhos. Se você tiver alterações não salvas, o navegador avisa antes de fechar.
