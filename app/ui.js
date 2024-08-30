import * as app from "./app.js";
addEventListener("popstate", (event) => {
    console.log("Popstate event")
    render()
});
document.getElementById("scanAllFilesBtn").addEventListener("click", scanAllFiles)
document.getElementById("largeFilesBtn").addEventListener("click", showLargeFiles)
document.getElementById("duplicatesBtn").addEventListener("click", showDuplicates)
setInterval(processingStatus, 1000)

async function render() {
    const url = new URL(window.location);
    let currentFolder = url.searchParams.get("folder")
    const fileDiv = document.getElementById("fileDiv");
    fileDiv.innerHTML = ""
    const statusDiv = document.getElementById("statusDiv");
    statusDiv.innerText = "Loading ..."
    app.readFolder(currentFolder, renderFiles).then(() => {
        statusDiv.innerText = ""
        renderPredictions()
    })
    app.parentFolders(currentFolder).then(renderParents)
}
function processingStatus() {
    const processingDiv = document.getElementById("processingDiv");
    let {inFlight, pending} = app.processingStatus()
    if (inFlight > 0 || pending > 0) {
        if (processingDiv.innerText.startsWith("Processing")) {
            processingDiv.innerText = processingDiv.innerText + "."
        } else { 
            processingDiv.innerText = "Processing ..."
        }
        if (processingDiv.innerText.length > 30) {
            processingDiv.innerText = processingDiv.innerText.substring(0, 15);
        }
    } else {
        processingDiv.innerText = ""
    }   
    
}

function renderParents(folders) {
    const breadCrumbDiv = document.getElementById("breadCrumb");

    let i = folders.length - 1
    breadCrumbDiv.innerHTML = ""
    while (i >= 0) {
        breadCrumbDiv.appendChild(document.createTextNode(" > "))
        let a = document.createElement("a")
        a.href = "javascript:void(0)"
        let id = folders[i].id
        a.onclick = () => {
            console.log("click", id)
            openFolder(id)
        }
        a.innerText = folders[i].name   
        breadCrumbDiv.appendChild(a)
        --i;
    }
}
function renderFiles(data) {
    if (!data.value) {
        alert("You do not have onedrive!")
    } else {
        const fileDiv = document.getElementById("fileDiv");
        const statusDiv = document.getElementById("statusDiv");
        statusDiv.innerText = statusDiv.innerText + "."

        data.value.map((d, i) => {
            fileDiv.appendChild(fileCard(d))
        });
    }
}

function formatFileSize(bytes, decimalPoint) {
    if (!bytes) return ""
    if (bytes == 0) return '0 Bytes';
    var k = 1000,
        dm = decimalPoint || 2,
        sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'],
        i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
function small(text) {
    let s = document.createElement("small")
    s.innerText = text
    return s
}

function fileCard(d) {
    const col = document.createElement("div");
    col.setAttribute("class", "col")
    const card = document.createElement("div");
    card.setAttribute("class", "card h-100");
    const body = document.createElement("div")
    const img = document.createElement("img")
    img.setAttribute("class", "card-img")
    img.setAttribute("id", "img_" + d.id)
    img.setAttribute("height", "160")
    if (d.folder) {
        img.setAttribute("src", "folder.svg")
    } else if (d.image) {
        img.setAttribute("src", "picture.svg")
    } else {
        img.setAttribute("src", "file.svg")
    }
    img.setAttribute("onclick", `window.open("${d.webUrl}")`)
    if (!d.folder && d.thumbnails && d.thumbnails.length > 0 && d.thumbnails[0].large) {
        img.setAttribute("src", d.thumbnails[0].large.url)
    }
    card.appendChild(img);
    body.setAttribute("class", "card-body");
    body.appendChild(small(prettyPath(d.parentReference.path)))
    body.appendChild(document.createElement("br"))  
    if (d.folder) {
        const link = document.createElement('a');
        link.href = 'javascript:void(0)';
        link.textContent = d.name;
        link.addEventListener('click', () => openFolder(d.id));
        body.appendChild(link)
    } else { 
        body.appendChild(small(d.name))
    }
    body.appendChild(document.createElement("br"))
    body.appendChild(small(formatFileSize(d.size, 2)))
    card.appendChild(body)
    const predictionDiv = document.createElement("div")
    predictionDiv.setAttribute("class", "card-footer prediction")
    predictionDiv.setAttribute("id", "prediction_" + d.id)
    card.appendChild(predictionDiv)
    col.appendChild(card)
    return col
}
async function renderPredictions() {
    let predictionDivs = document.getElementsByClassName("prediction")
    for (let p of predictionDivs) {
        let id = p.id.replace("prediction_", "")
        let emb = await app.getEmbedding(id)
        if (emb && emb.embeddings) {
            p.innerHTML = ''
            let btn = document.createElement("button")
            btn.innerText = "Similar"
            btn.onclick = () => showSimilarFiles(id)
            p.appendChild(btn)
            p.appendChild(document.createElement("br"))
            let predictions = document.createElement("p")
            predictions.innerText = emb.predictions.map((p) => `${p.className} (${Math.round(p.probability * 100)}%)`).join(", ")   
            p.appendChild(predictions)

        }
    }
}

async function openFolder(id) {

    const url = new URL(window.location);
    if (!id) {
        id = url.searchParams.get("folder")
    }
    if (url.searchParams.get("folder") != id) {
        url.searchParams.set("folder", id);
        window.history.pushState({}, "", url);
    }
    render()
}
function scanAllFiles() {
    app.cacheAllFiles(onScanLog)
}
function onScanLog({ urls, processed }) {
    let log = document.getElementById("scanLog")
    log.innerHTML = `<small>${urls.map((o) => o.path.replace('/drive/root:', '')).join("<br/>")}</small>`
}

async function showLargeFiles() {

    let list = await app.largeFiles()
    let div = document.getElementById("largeFilesDiv")
    div.innerHTML = ''
    for (let d of list) {
        div.appendChild(fileCard(d))
    }
}
async function showSimilarFiles(id) {
    let embedding = await app.getEmbedding(id)
    let list = await app.findSimilarImages(embedding.embeddings)
    document.getElementById("detail-tab").click()
    let div = document.getElementById("detailDiv")
    div.innerHTML = ''
    for (let d of list) {
        console.log('Similar:', d)
        div.appendChild(fileCard(d))
    }
}
let pairs = {}
async function showDuplicates() {
    pairs = await app.findDuplicates()


    let div = document.getElementById("largeFilesDiv")
    let keys = Object.keys(pairs).sort((a, b) => pairs[b][0].items.length - pairs[a][0].items.length)
    div.innerHTML = ""
    for (let k of keys) {
        div.appendChild(duplicateCard(k, pairs[k]))
    }
    // for (let d of list) {
    //     div.appendChild(fileCard(d))
    // }
}

function prettyPath(path) {
    return decodeURI(path.replace('/drive/root:', ''))
}
function duplicateCard(key, d) {
    const col = document.createElement("div");
    col.setAttribute("class", "col")
    const card = document.createElement("div");
    card.setAttribute("class", "card h-100");
    const body = document.createElement("div")
    body.setAttribute("class", "card-body");
    let html = `${d[0].items.length} duplicates<br/>`
    html += `<small>${prettyPath(d[0].path)}</small><br/>`
    html += `<button onclick="showDetails('${key}',0)">show</button><button onclick="deleteDuplicates('${key}',0)">delete</button><br/>`
    html += `<small>${prettyPath(d[1].path)}</small><br/>`
    html += `<button onclick="showDetails('${key}',1)">show</button><button onclick="deleteDuplicates('${key}',1)">delete</button>`
    body.innerHTML = html
    card.appendChild(body)
    col.appendChild(card)
    return col
}
function showDetails(key, index) {
    document.getElementById("detail-tab").click()
    let div = document.getElementById("detailDiv")
    div.innerHTML = ""
    console.log("Details for:", pairs[key][index].items.length)
    for (let f of pairs[key][index].items) {

        div.appendChild(fileCard(f))
    }

}

async function deleteDuplicates(key, index) {
    deleteItems(pairs[key][index].items).then((res) => {
        deleteFromCache(pairs[key][index].items)
        console.log(res)
    })
}

function showWelcomeMessage(username) {
    // Select DOM elements to work with
    const signInButton = document.getElementById("SignIn");
    // Reconfiguring DOM elements
    signInButton.setAttribute("onclick", "signOut();");
    signInButton.setAttribute('class', "btn btn-success")
    signInButton.innerHTML = "Sign Out";
}

export {openFolder, showWelcomeMessage }