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
                
                // 3. Forçar 'latin1' para domínios que enviam dados ISO-8859-1 (Ex: A Bola e Record)
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
    
    // 1. Remove qualquer CDATA normal ou oculto por double-encoding de variadíssimas formas
    str = str.replace(/<!\[CDATA\[/gi, "");
    str = str.replace(/\]\]>/gi, "");
    str = str.replace(/&lt;!\[CDATA\[/gi, "");
    str = str.replace(/\]\]&gt;/gi, "");
    str = str.replace(/CDATA/g, "");
    
    // 2. Descodifica as entidades básicas
    str = str.replace(/&amp;/g, "&")
             .replace(/&lt;/g, "<")
             .replace(/&gt;/g, ">")
             .replace(/&quot;/g, '"')
             .replace(/&#39;/g, "'");
             
    // 3. Remove todas as tags HTML que tenham sobrado
    str = str.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    str = str.replace(/<[^>]+>/g, "");
    
    // 4. Limpeza final absoluta para limpar os delimitadores que possam ter ficado perdidos por acidentes de texto
    str = str.replace("<![CDATA[", "").replace("]]>", "");
    str = str.replace("<![CDATA[", "").replace("]]>", ""); // Dupla confirmação por segurança
    
    return str.replace(/\s+/g, " ").trim();
}

// Função para obter o Favicon do domínio
function getFav(url) {
    try {
        const hostname = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`;
    } catch (e) { return ""; }
}

// Tradutor otimizado com Timeout de segurança para evitar que o robô bloqueie
async function traduzirTexto(texto) {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=pt&dt=t&q=${encodeURIComponent(texto)}`;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // Máximo 3 segundos por tradução
        
        const res = await fetchUrl(url);
        clearTimeout(timeoutId);
        
        const json = JSON.parse(res);
        return json[0][0][0];
    } catch (e) {
        return texto; // Se demorar ou falhar, mantém o original instantaneamente e segue em frente
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

// Regex aprimorada e ultra-abrangente para extrair imagens escondidas em descrições HTML
function extrairImagemDoTexto(texto) {
    if (!texto) return "";
    
    // Captura tags <img ... src="..."> lidando com qualquer tipo de aspas ou atributos extras intermédios
    const imgRegex = /<img[^>]+?\b(?:src|data-src|data-lazy-src|data-original|url)\s*=\s*["']([^"'\s>]+)/i;
    let match = texto.match(imgRegex);
    if (match && match[1] && match[1].length > 10 && !match[1].includes("favicon")) {
        return match[1].trim().replace(/&amp;/g, "&");
    }

    // Se falhar, captura links diretos de imagens estáticas no texto
    const urlRegex = /(https?:\/\/[^"'\s<>]+?\.(?:jpg|jpeg|png|webp|gif))/i;
    match = texto.match(urlRegex);
    if (match && match[1]) {
        return match[1].trim();
    }

    return "";
}

// Captura e faz o parse manual simplificado de um feed XML
async function processarFeed(feed) {
    try {
        const xmlRaw = await fetchUrl(feed.u);
        
        // Remove o caractere invisível BOM (\uFEFF) e espaços em branco iniciais
        const xml = xmlRaw.replace(/^\uFEFF/, '').trim();
        
        if (!xml.startsWith('<')) {
            console.error(`Aviso: O feed de ${feed.n} não retornou um XML válido.`);
            return [];
        }
        
        const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
        let match;
        const artigos = [];
        let contador = 0;

        while ((match = itemRegex.exec(xml)) !== null && contador < 9) {
            const itemXml = match[1];

            // 1. Procura e limpa o título
            const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            let rawTitle = titleMatch ? titleMatch[1] : "";
            let title = cleanText(rawTitle);
            
            if (!title && rawTitle) {
                title = rawTitle.replace(/<[^>]*>/g, "").trim();
            }
            if (!title) continue;

            // 2. Repara os acentos corrompidos resultantes do Double-Encoding
            title = title
                .replace(/Ã³/g, "ó").replace(/Ã³/g, "ó")
                .replace(/Ã\u00a7/g, "ç").replace(/Ã§/g, "ç")
                .replace(/Ã\u00a3/g, "ã").replace(/Ã£/g, "ã")
                .replace(/Ã\u00a9/g, "é").replace(/Ã©/g, "é")
                .replace(/Ã\u00a1/g, "á").replace(/Ã¡/g, "á")
                .replace(/Ã\u00ad/g, "í").replace(/Ã\u00ad/g, "í")
                .replace(/Ã¢/g, "â").replace(/Ã¢/g, "â")
                .replace(/Ãª/g, "ê").replace(/Ãª/g, "ê")
                .replace(/Ãµ/g, "õ").replace(/Ãµ/g, "õ")
                .replace(/Ãº/g, "ú").replace(/Ãº/g, "ú")
                .replace(/Ã\u00a0/g, "à").replace(/Ã /g, "à")
                .replace(/Âº/g, "º").replace(/Âº/g, "º")
                .replace(/Âª/g, "ª").replace(/Âª/g, "ª")
                .replace(/Ã“/g, "Ó").replace(/Ã‡/g, "Ç")
                .replace(/Ã/g, "É").replace(/Ã\u0081/g, "Á")
                .replace(/Ãƒ/g, "Ã").replace(/â€“/g, "—")
                .replace(/â€œ/g, '"').replace(/â€\u009d/g, '"');

            // 3. Limpeza final de resíduos CDATA
            title = title.replace(/<!\[CDATA\[/gi, "").replace(/\]\]>/gi, "").trim();

            // 4. Procura pelo link do artigo
            const linkMatch = itemXml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
            const link = linkMatch ? linkMatch[1].trim() : "";

            // 5. Procura por data de publicação
            const pubDateMatch = itemXml.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
            const pubDate = pubDateMatch ? new Date(pubDateMatch[1]) : new Date();

            // 6. Traduz se o feed estiver marcado como inglês
            if (feed.l === "en") {
                title = await traduzirTexto(title);
            }

            // 7. NOVO ALGORITMO DE EXTRAÇÃO EXTRA-AGRESSIVO DE IMAGENS FEITO PARA PORTUGAL
            let thumb = "";
            
            // Tenta obter de qualquer variação de tag de média ou enclosure (com suporte a namespaces dinâmicos)
            const urlImgRegex = /\burl\s*=\s*["']([^"'\s>]+)/i;
            const enclosureMatch = itemXml.match(/<enclosure[^>]+?url\s*=\s*["']([^"'\s>]+)/i) ||
                                  itemXml.match(/<media:content[^>]+?url\s*=\s*["']([^"'\s>]+)/i) ||
                                  itemXml.match(/<media:thumbnail[^>]+?url\s*=\s*["']([^"'\s>]+)/i) ||
                                  itemXml.match(/<image[^>]*>([\s\S]*?)<\/image>/i);

            if (enclosureMatch) {
                if (enclosureMatch[1] && enclosureMatch[1].length > 10) {
                    thumb = enclosureMatch[1].trim();
                } else if (enclosureMatch[1]) {
                    // Se capturou a tag de imagem interna complexa, limpa o seu conteúdo
                    const subUrl = enclosureMatch[1].match(/<url[^>]*>([\s\S]*?)<\/url>/i);
                    if (subUrl) thumb = subUrl[1].trim();
                }
            }

            // Se as tags estruturadas falharem, varre o texto descritivo por tags HTML de imagem
            if (!thumb || thumb.includes("favicon") || thumb.length < 10) {
                const descMatch = itemXml.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
                const contentMatch = itemXml.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);
                const textoParaProcurar = (descMatch ? descMatch[1] : "") + (contentMatch ? contentMatch[1] : "");
                thumb = extrairImagemDoTexto(textoParaProcurar);
            }

            // Fallbacks de imagens fixas de alta resolução baseadas na fonte
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
                i: (thumb && !thumb.includes("favicon") && thumb.length > 10) ? thumb.replace(/&amp;/g, "&") : "",
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

async function ejecutar() {
    console.log("A iniciar processamento dos feeds no servidor...");
    
    try {
        // 1. Descarrega a lista de fontes ativas
        const fontesRaw = await fetchUrl(JSON_FEEDS_URL);
        const fontes = JSON.parse(fontesRaw);
        
        let todosArtigosPlanos = [];
        let gruposNoticias = [];

        // 2. Processa cada feed (um por um)
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

        // 3. Ordena a lista plana de artigos (Mais recentes primeiro)
        todosArtigosPlanos.sort((a, b) => new Date(b.p) - new Date(a.p));

        // 4. Ordena os grupos pela ordem de prioridade definida
        gruposNoticias.sort((a, b) => {
            const idxA = priorityOrder.indexOf(a.nome);
            const idxB = priorityOrder.indexOf(b.nome);
            return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
        });

        // 5. Filtra as fontes ativas para o front
        const fontesAtivas = fontes.filter(f => gruposNoticias.some(g => g.nome === f.n));

        const resultadoFinal = {
            ultimasAtualizacao: new Date().toISOString(),
            fontesAtivas: fontesAtivas,
            todosArtigosPlanos: todosArtigosPlanos, 
            gruposPorPrioridade: gruposNoticias 
        };

        // Grava o ficheiro final
        fs.writeFileSync('noticias_final.json', JSON.stringify(resultadoFinal, null, 2));
        console.log("Super JSON gerado com sucesso!");
    } catch (err) {
        console.error("Erro fatal na execução do script:", err.message);
    }
}

ejecutar();
