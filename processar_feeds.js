const fs = require('fs');
const https = require('https');

// Configurações dos URLs base
const JSON_FEEDS_URL = "https://raw.githack.com/gist/marcosmelo1-collab/a6564ddeec0f72ffeb9918cb5c16a873/raw/feeds.json";
const priorityOrder = [
    "Observador", "Mega Hits", "Notícias ao Minuto", "Vagalume", 
    "SIC Notícias", "Papelpop", "Magazine HD", "RTP", 
    "PopNow", "Renascença", "In Magazine", "Billboard", "NiT"
];

// Função utilitária para fazer requisições HTTP (GET) nativas e decodificar perfeitamente os caracteres
function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
            const chunks = [];
            
            res.on('data', chunk => chunks.push(chunk));
            
            res.on('end', () => {
                const bufferCompleto = Buffer.concat(chunks);
                
                // 1. Detetar encoding pelo cabeçalho do servidor
                const contentType = res.headers['content-type'] || '';
                let encoding = 'utf-8';
                
                if (contentType.toLowerCase().includes('iso-8859-1') || contentType.toLowerCase().includes('windows-1252')) {
                    encoding = 'latin1';
                }
                
                // 2. Detetar encoding inspecionando a tag inicial do XML
                if (encoding === 'utf-8') {
                    const amostraTexto = bufferCompleto.slice(0, 250).toString('ascii');
                    if (amostraTexto.toLowerCase().includes('encoding="iso-8859-1"') || 
                        amostraTexto.toLowerCase().includes('encoding="windows-1252"')) {
                        encoding = 'latin1';
                    }
                }
                
                // 3. REPARAÇÃO: Forçar 'latin1' para domínios que enviam dados ISO-8859-1 (Ex: A Bola e Record)
                const urlLower = url.toLowerCase();
                if (urlLower.includes('abola.pt') || urlLower.includes('record.pt')) {
                    encoding = 'latin1';
                }
                
                // Decodifica o buffer usando a estratégia apurada
                let textoDecodificado = bufferCompleto.toString(encoding);
                
                // 4. Correção extra de segurança contra dupla conversão (Double-Encoding)
                if (textoDecodificado.includes('\u00c3') || textoDecodificado.includes('\u00e3')) {
                    try {
                        textoDecodificado = decodeURIComponent(escape(textoDecodificado));
                    } catch(e) {
                        textoDecodificado = textoDecodificado
                            .replace(/NOTCIAS/g, "NOTÍCIAS")
                            .replace(/OPINIO/g, "OPINIÃO")
                            .replace(/EM FCO/g, "EM FOCO")
                            .replace(/CONCEIO/g, "CONCEIÇÃO")
                            .replace(/SELEO/g, "SELEÇÃO");
                    }
                }
                
                resolve(textoDecodificado);
            });
        }).on('error', err => reject(err));
    });
}

// Função perfeitamente calibrada para limpar CDATA e tags HTML (Garante compatibilidade total com o Record)
function cleanText(txt) {
    if (!txt) return "";
    
    let str = txt;
    
    // 1. Remove os delimitadores de CDATA primeiro
    str = str.replace(/<!\[CDATA\[/gi, "");
    str = str.replace(/\]\]>/gi, "");
    
    // 2. Descodifica JÁ as entidades básicas para evitar que o conteúdo fique camuflado
    str = str.replace(/&amp;/g, "&")
             .replace(/&lt;/g, "<")
             .replace(/&gt;/g, ">")
             .replace(/&quot;/g, '"')
             .replace(/&#39;/g, "'");
             
    // 3. Remove apenas as tags HTML estruturais (<p>, <img>, <a>) sem corromper o texto envolvente
    str = str.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ""); // Remove scripts se houver
    str = str.replace(/<[^>]+>/g, ""); // Remove tags mas protege texto livre
    
    // 4. Limpeza final de espaços duplicados
    return str.replace(/\s+/g, " ").trim();
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
        const res = await fetchUrl(url);
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
// Substitua a função processarFeed antiga no seu Node.js por esta versão limpa:
async function processarFeed(feed) {
    try {
        const xmlRaw = await fetchUrl(feed.u);
        
        // CORREÇÃO CRÍTICA: Remove o caractere invisível BOM (\uFEFF) e espaços em branco iniciais para evitar SAXParseException (prolog error)
        const xml = xmlRaw.replace(/^\uFEFF/, '').trim();
        
        // Validação básica para garantir que o retorno não é um HTML de erro ou bloqueio
        if (!xml.startsWith('<')) {
            console.error(`Aviso: O feed de ${feed.n} não retornou um XML válido.`);
            return [];
        }
        
        // Regex insensível a maiúsculas para capturar blocos <item> ou <ITEM>
        const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
        let match;
        const artigos = [];
        let contador = 0;

        while ((match = itemRegex.exec(xml)) !== null && contador < 9) {
            const itemXml = match[1];

            // 1. Captura o título de forma tolerante e limpa as tags HTML
            const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            let rawTitle = titleMatch ? titleMatch[1] : "";
            let title = cleanText(rawTitle);
            
            if (!title && rawTitle) {
                title = rawTitle.replace(/<[^>]*>/g, "").trim();
            }
            if (!title) continue;

            // CORREÇÃO CIRÚRGICA: Repara o Double-Encoding de caracteres corrompidos comuns (Record/FeedBurner)
            title = title
                .replace(/Ã³/g, "ó").replace(/Ã³/g, "ó")
                .replace(/Ã§/g, "ç").replace(/Ã§/g, "ç")
                .replace(/Ã£/g, "ã").replace(/Ã£/g, "ã")
                .replace(/Ã©/g, "é").replace(/Ã©/g, "é")
                .replace(/Ã¡/g, "á").replace(/Ã¡/g, "á")
                .replace(/Ã­/g, "í").replace(/Ã\u00ad/g, "í")
                .replace(/Ã¢/g, "â").replace(/Ã¢/g, "â")
                .replace(/Ãª/g, "ê").replace(/Ãª/g, "ê")
                .replace(/Ãµ/g, "õ").replace(/Ãµ/g, "õ")
                .replace(/Ãº/g, "ú").replace(/Ãº/g, "ú")
                .replace(/Ã /g, "à").replace(/Ã /g, "à")
                .replace(/Âº/g, "º").replace(/Âº/g, "º")
                .replace(/Âª/g, "ª").replace(/Âª/g, "ª")
                .replace(/Ã“/g, "Ó").replace(/Ã‡/g, "Ç")
                .replace(/Ã/g, "É").replace(/Ã\u0081/g, "Á")
                .replace(/Ãƒ/g, "Ã").replace(/â€“/g, "—")
                .replace(/â€œ/g, '"').replace(/â€\u009d/g, '"');

            // 2. Procura por <link> ou <LINK> de forma insensível
            const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
            const link = linkMatch ? linkMatch[1].trim() : "";

            // 3. Procura por data de publicação
            const pubDateMatch = itemXml.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
            const pubDate = pubDateMatch ? new Date(pubDateMatch[1]) : new Date();

            // 4. Traduz se o feed estiver marcado como inglês
            if (feed.l === "en") {
                title = await traduzirTexto(title);
            }

            // 5. Tenta encontrar imagens nas tags conhecidas
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
            else if (domain.includes("record")) fallbackImg = "https://images.weserv.nl/?url=cdn.record.pt/images/og-image.png";
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
    } catch (e) {
        console.error(`Erro ao processar fonte ${feed.n}:`, e.message);
        return [];
    }
}

async function ejecutar() {
    console.log("A iniciar processamento dos feeds no servidor...");
    
    try {
        // 1. Descarrega a lista de fontes ativas
        const fontesRaw = await fetchUrl(JSON_FEEDS_URL);
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
            todosArtigosPlanos: todosArtigosPlanos, 
            gruposPorPrioridade: gruposNoticias 
        };

        // Grava o ficheiro temporário local que o GitHub Actions vai enviar para o teu Gist
        fs.writeFileSync('noticias_final.json', JSON.stringify(resultadoFinal, null, 2));
        console.log("Super JSON gerado com sucesso!");
    } catch (err) {
        console.error("Erro fatal na execução do script:", err.message);
    }
}

ejecutar();
