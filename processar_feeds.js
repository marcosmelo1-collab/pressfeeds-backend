const fs = require('fs');
const https = require('https');

// Configurações dos URLs base
const JSON_FEEDS_URL = "https://raw.githack.com/gist/marcosmelo1-collab/a6564ddeec0f72ffeb9918cb5c16a873/raw/feeds.json";
const priorityOrder = [
    "Observador", "Mega Hits", "Notícias ao Minuto", "Vagalume", 
    "SIC Notícias", "Papelpop", "Magazine HD", "RTP", 
    "PopNow", "Renascença", "In Magazine", "Billboard", "NiT"
];

// Função utilitária para fazer requisições HTTP (GET) nativas retornar uma Promessa
function fecthUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', err => reject(err));
    });
}

// Função para limpar CDATA e tags HTML básicas
function cleanText(txt) {
    if (!txt) return "";
    let str = txt.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    str = str.replace(/<[^>]*>/g, ""); // Remove tags HTML
    return str;
}

// Função para obter o Favicon do domínio
function getFav(url) {
    try {
        const hostname = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`;
    } catch (e) { return ""; }
}

// Tradutor em background usando a API estável do Google Translate (sem necessidade de chaves)
async function traduzirTexto(texto) {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt&dt=t&q=${encodeURIComponent(texto)}`;
        const res = await fecthUrl(url);
        const json = JSON.parse(res);
        return json[0][0][0];
    } catch (e) {
        return texto; // Se falhar, mantém o original por segurança
    }
}

// Formatador de data simplificado que roda no servidor
function formatarData(dateObj) {
    const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    const dia = dateObj.getDate();
    const mes = meses[dateObj.getMonth()];
    const hora = String(dateObj.getHours()).padStart(2, '0');
    const min = String(dateObj.getMinutes()).padStart(2, '0');
    return `${dia} de ${mes} ${hora}:${min}`;
}

// Regex para capturar a primeira imagem de uma descrição/conteúdo caso não haja enclosure
function extrairImagemDoTexto(texto) {
    const imgRegex = /<img[^>]+(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)["']/i;
    const match = texto.match(imgRegex);
    return match ? match[1] : "";
}

// Captura e faz o parse manual simplificado de um feed XML
async function processarFeed(feed) {
    try {
        const xml = await fecthUrl(feed.u);
        // Regex simples para capturar blocos <item>
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;
        const artigos = [];
        let contador = 0;

        while ((match = itemRegex.exec(xml)) !== null && contador < 9) {
            const itemXml = match[1];

            const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/);
            let title = titleMatch ? cleanText(titleMatch[1]) : "";
            if (!title) continue;

            const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/);
            const link = linkMatch ? linkMatch[1].trim() : "";

            const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
            const pubDate = pubDateMatch ? new Date(pubDateMatch[1]) : new Date();

            // Traduz se o feed estiver marcado como inglês
            if (feed.l === "en") {
                title = await traduzirTexto(title);
            }

            // Tenta encontrar imagens nas tags conhecidas
            let thumb = "";
            const mediaMatch = itemXml.match(/<media:content[^>]+url=["']([^"']+)["']/i) || 
                               itemXml.match(/<enclosure[^>]+url=["']([^"']+)["']/i) || 
                               itemXml.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
            
            if (mediaMatch) {
                thumb = mediaMatch[1];
            } else {
                thumb = extrairImagemDoTexto(itemXml);
            }

            // Fallbacks de imagens fixas baseadas no nome da fonte (idêntico ao teu front-end)
            let fallbackImg = `https://images.weserv.nl/?url=${encodeURIComponent(getFav(feed.u))}&w=120&h=120&fit=contain`;
            const domain = feed.n.toLowerCase();
            if (domain.includes("magazine hd") || domain.includes("magazinehd")) fallbackImg = "https://images.weserv.nl/?url=www.magazine-hd.com/apps/wp/wp-content/uploads/2023/01/mhd-logo.jpg";
            else if (domain.includes("billboard")) fallbackImg = "https://www.billboard.com/wp-content/themes/vip/pmc-billboard-2021/assets/public/lazyload.png";
            else if (domain.includes("cnn")) fallbackImg = "https://images.weserv.nl/?url=cnnportugal.iol.pt/assets/images/logos/cnn-portugal.png";
            else if (domain.includes("bola")) fallbackImg = "https://images.weserv.nl/?url=www.abola.pt/img/og-image.png";
            else if (domain.includes("público") || domain.includes("publico")) fallbackImg = "https://images.weserv.nl/?url=data.publico.pt/assets/images/facebook-opengraph.png";

            artigos.push({
                t: title,
                l: link,
                i: (thumb && !thumb.includes("favicon") && thumb.length > 10) ? thumb : "",
                fallback: fallbackImg,
                p: pubDate.toISOString(),
                data_formatada: formatarData(pubDate),
                fav: getFav(feed.u),
                n: feed.n
            });
            contador++;
        }

        return artigos;
    } catch (e) {
        console.error(`Erro ao processar fonte ${feed.n}:`, e.message);
        return [];
    }
}

async function executar() {
    console.log("A iniciar processamento dos feeds no servidor...");
    
    // 1. Descarrega a lista de fontes ativas
    const fontesRaw = await fecthUrl(JSON_FEEDS_URL);
    const fontes = JSON.parse(fontesRaw);
    
    let todosArtigosPlanos = [];
    let gruposNoticias = [];

    // 2. Processa cada feed (um por um para evitar sobrecarga de conexões)
    for (const fonte of fontes) {
        console.log(`A recolher: ${fonte.n}`);
        const artigosDaFonte = await processarFeed(fonte);
        if (artigosDaFonte.length > 0) {
            todosArtigosPlanos = todosArtigosPlanos.concat(artigosDaFonte);
            
            gruposNoticias.push({
                nome: fonte.n,
                categoria: fonte.c,
                artigos: artigosDaFonte
            });
        }
    }

    // 3. Ordena a lista plana de artigos de forma global (Mais recentes primeiro)
    todosArtigosPlanos.sort((a, b) => new Date(b.p) - new Date(a.p));

    // 4. Ordena os grupos pela ordem de prioridade definida
    gruposNoticias.sort((a, b) => {
        const idxA = priorityOrder.indexOf(a.nome);
        const idxB = priorityOrder.indexOf(b.nome);
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });

    // 5. Filtra as fontes ativas para remontar o dropdown de forma limpa no front
    const fontesAtivas = fontes.filter(f => gruposNoticias.some(g => g.nome === f.n));

    // Estrutura o Objeto Final mastigado
    const resultadoFinal = {
        ultimasAtualizacao: new Date().toISOString(),
        fontesAtivas: fontesAtivas,
        todosArtigosPlanos: todosArtigosPlanos, // Usado para quando filtram por uma fonte específica (Ex: Ver Tudo +)
        gruposPorPrioridade: gruposNoticias      // Usado para montar a grelha inicial (1 notícia grande + 2 sub-itens)
    };

    // Grava o ficheiro temporário local que o GitHub Actions vai enviar para o teu Gist
    fs.writeFileSync('noticias_final.json', JSON.stringify(resultadoFinal, null, 2));
    console.log("Super JSON gerado com sucesso!");
}

executar();
