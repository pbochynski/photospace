import * as app from "./app.js";
import { getEmbedding } from "./db.js"; 
import { importDatabase, exportDatabase, cleanEmbeddings, quickEmbeddings } from "./impex.js";
import { search } from "./search.js";

addEventListener("popstate", (event) => {
    console.log("Popstate event")
    render()
});

function addToolsButtons() {
    const tools = [
        {label: "Scan All Files", fn: scanAllFiles},
        {label: "Clean Embeddings", fn: cleanEmbeddings},
        {label: "Quick Embeddings", fn: quickEmbeddings},
        {label: "Missing Embeddings", fn: app.queueMissingEmbeddings},
        {label: "Large Files", fn: showLargeFiles},
        {label: "Duplicates", fn: showDuplicates},
        {label: "Export", fn: exportHandler},
        {label: "Import", fn: importHandler},
    ]
    const toolsDiv = document.getElementById("toolsDiv")
    toolsDiv.innerHTML = ""
    for (let t of tools) {
        let btn = document.createElement("button")
        btn.innerText = t.label
        btn.onclick = t.fn
        toolsDiv.appendChild(btn)
    }
}
addToolsButtons()

async function importHandler(e) {    
    let btn = e.target
    const [fileHandle] = await window.showOpenFilePicker();
    const file = await fileHandle.getFile();
    btn.disabled = true
    btn.innerText = "Importing ..."
    const db = await importDatabase(file);
    console.log("Imported db", db)
    btn.innerText = "Import"
    btn.disabled = false    
    render()
}
setInterval(processingStatus, 1000)

function searchCallback(data){
    console.log("Search callback", data)
    document.getElementById("search-tab").click()

    let div = document.getElementById("searchDiv")
    div.innerHTML = ""
    if (data.files){
        for (let d of data.files) {
            div.appendChild(fileCard(d))
        }
    
    }
}
// register callback for search text input field that triggers search when enter is pressed
document.getElementById("searchText").addEventListener("keyup", function(event) {
    if (event.key === "Enter") {
        event.preventDefault();
        search({query:document.getElementById("searchText").value}, searchCallback)
    }
})


async function exportHandler(e){
    let btn = e.target
    const opts = {
        types: [{
            description: 'My onedrive files',
            suggestedName: 'my-files.json',
            accept: { 'text/json': ['.json'] },
        }],
    };
    const handle = await window.showSaveFilePicker(opts);
    const writable = await handle.createWritable();
    // disable button
    btn.disabled = true
    btn.innerText = "Exporting ..."
    let blob = await exportDatabase("Embeddings")
    btn.innerText = "Writing ..."
    await writable.write(blob);
    await writable.close();
    btn.innerText = "Export"
    btn.disabled = false

}

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
async function processingStatus() {
    const processingDiv = document.getElementById("processingDiv");
    let { pending, processed, cacheProcessed, cacheQueue } = await app.processingStatus()
    if (pending > 0 || cacheQueue > 0) {
        processingDiv.innerText = `Processing (${processed}/${pending + processed}), cacheQueue: ${cacheQueue}`    
    } else {
        if (processingDiv.innerText.startsWith("Processing (")) {
            processingDiv.innerText = "Processing done."
            console.log("Processing done, rendering predictions")
            renderPredictions()
        } else {
            processingDiv.innerText = ""
        }
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

function filePath(d) {
    if (d.parentReference) {
        return prettyPath(d.parentReference.path) + '/' + d.name
    }
    if (d.path) {
        return prettyPath(d.path) + '/' + d.name
    }
    return d.name
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
    } else if (d.thumbnailUrl) {
        img.setAttribute("src", d.thumbnailUrl)
    }
    card.appendChild(img);

    body.setAttribute("class", "card-body");
    if (d.folder) {
        let scanBtn = document.createElement("button")
        scanBtn.innerText = "Scan"
        scanBtn.onclick = () => app.cacheAllFiles(d.id)  
        body.appendChild(scanBtn)
        const link = document.createElement('a');
        link.href = 'javascript:void(0)';
        link.textContent = d.name;
        link.addEventListener('click', () => openFolder(d.id));
        body.appendChild(link)
        body.appendChild(document.createElement("br"))
    } else {
        body.appendChild(small(filePath(d)))
    }
    body.appendChild(document.createElement("br"))
    body.appendChild(small(formatFileSize(d.size, 2)))
    if (d.distance) {
        body.appendChild(document.createElement("br"))
        body.appendChild(small("Distance: " + d.distance.toFixed(2)))
    }
    card.appendChild(body)
    const predictionDiv = document.createElement("div")
    predictionDiv.setAttribute("class", "card-footer prediction")
    predictionDiv.setAttribute("id", "prediction_" + d.id)
    if (d.embeddings) {
        let btn = document.createElement("button")
        btn.innerText = "Similar"
        btn.onclick = () => searchSimilarHandler(d.id)
        predictionDiv.appendChild(btn)
    }

    card.appendChild(predictionDiv)
    col.appendChild(card)
    return col
}

function searchSimilarHandler(id){
    document.getElementById("search-tab").click()
    let query = document.getElementById("searchText").value
    search({similar:id, query}, searchCallback)
}

async function renderPredictions() {
    let predictionDivs = document.getElementsByClassName("prediction")
    for (let p of predictionDivs) {
        let id = p.id.replace("prediction_", "")
        if (p.innerHTML == "") {
            let emb = await getEmbedding(id)
            if (emb && emb.embeddings) {
                p.innerHTML = ''
                let btn = document.createElement("button")
                btn.innerText = "Similar"
                btn.onclick = () => searchSimilarHandler(id)
                p.appendChild(btn)
            }
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
    app.cacheAllFiles()
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
    let embedding = await getEmbedding(id)
    let list = await app.findSimilarImages(embedding.embeddings)
    document.getElementById("detail-tab").click()
    let div = document.getElementById("detailDiv")
    div.innerHTML = ''
    for (let d of list) {
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

export { openFolder, showWelcomeMessage }