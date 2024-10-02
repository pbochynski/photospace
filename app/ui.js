import * as app from "./app.js";
import { importDatabase, exportDatabase, cleanEmbeddings, clearDB, exportToOneDrive, importFromOneDrive } from "./impex.js";
import { search } from "./search.js";
import { getAllAlbums, getAlbum, indexAlbums, getFileAlbums, getAlbumName } from "./album.js";

addEventListener("popstate", (event) => {
    console.log("Popstate event")
    podStateHandler(event)
});

function activateContent(id) {

    const url = new URL(window.location);
    let viewId = url.searchParams.get("view")
    if (viewId != id) {
        url.searchParams.set("view", id);
        window.history.pushState({}, "", url);
    }


    const tabs = document.getElementsByClassName("content");
    for (let tab of tabs) {
        tab.style.display = "none";
    }

    const navButtons = document.querySelectorAll('.nav-button');
    navButtons.forEach(button => button.classList.remove('active'));

    const buttons = document.querySelectorAll(`.${id}-button`);
    buttons.forEach(button => button.classList.add('active'));

    document.getElementById('side-menu').style.display = 'none';
    document.getElementById(id).style.display = "block";
}

function addListenerToAll(selector, event, handler) {
    document.querySelectorAll(selector).forEach((element) => {
        element.addEventListener(event, handler);
    });
}

document.addEventListener('DOMContentLoaded', () => {

    const buttons = ['home', 'drive', 'search', 'tools', 'album']
    const menuButton = document.getElementById('menu-button');
    const sideMenu = document.getElementById('side-menu');
    // const signInButton = document.getElementById('sign-in-button');
    // const userSection = document.getElementById('user-section');

    for (let b of buttons) {
        addListenerToAll(`.${b}-button`, 'click', () => {
            activateContent(b);
        });
    }
    addListenerToAll('.album-button', 'click', openAlbum());
    addListenerToAll('.drive-button', 'click', () => openFolder());

    menuButton.addEventListener('click', () => {
        sideMenu.style.display = sideMenu.style.display === 'block' ? 'none' : 'block';
    });
    addToolsButtons()
    setInterval(processingStatus, 1000)
    // register callback for search text input field that triggers search when enter is pressed
    document.getElementById("searchText").addEventListener("keyup", function (event) {
        if (event.key === "Enter") {
            event.preventDefault();
            search({ query: document.getElementById("searchText").value }, searchCallback)
        }
    })
    document.getElementById("searchButton").onclick = function () {
        search({ query: document.getElementById("searchText").value }, searchCallback)
    }

    podStateHandler()
    // signInButton.addEventListener('click', () => {
    //     // Handle sign-in logic here
    //     // For demonstration, we'll just replace the button with a user icon
    //     userSection.innerHTML = '<img src="user-icon.png" alt="User Icon" class="user-icon">';
    // });
});
function testGPU() {
    if (!navigator.gpu) {
        throw new Error("WebGPU not supported on this browser.");
    }
}
function addToolsButtons() {
    const tools = [
        { label: "Scan All Files", fn: scanAllFiles },
        { label: "Fix Embeddings", fn: cleanEmbeddings },
        { label: "Clear DB", fn: clearDbHandler },
        { label: "Missing Embeddings", fn: app.queueMissingEmbeddings },
        { label: "Export", fn: exportHandler },
        { label: "Import", fn: importHandler },
        { label: "Export to OneDrive", fn: exportToOneDriveHandler },
        { label: "Import from OneDrive", fn: importFromOneDriveHandler },
        { label: "Index albums", fn: indexAlbums },
        { label: "GPU test", fn: testGPU },
        { label: "Start workers", fn: app.startVisionWorkers },
    ]
    const toolsDiv = document.getElementById("toolsDiv")
    toolsDiv.innerHTML = ""
    for (let t of tools) {
        let btn = document.createElement("button")
        btn.innerText = t.label
        btn.setAttribute("class", "btn btn-primary btn-sm")
        btn.onclick = t.fn
        toolsDiv.appendChild(btn)
    }
}


async function clearDbHandler(e) {
    let btn = e.target
    btn.disabled = true
    btn.innerText = "Clearing ..."
    await clearDB()
    btn.innerText = "Clear DB"
    btn.disabled = false
}
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
}

function albumCard(a) {
    let card = document.createElement("div");
    card.setAttribute("class", "album-card");

    let imgWrapper = document.createElement("div");
    imgWrapper.setAttribute("class", "img-wrapper");

    let img = document.createElement("img");
    img.src = a.thumbnails[0].large.url;
    imgWrapper.appendChild(img);

    let link = document.createElement("a");
    link.href = "javascript:void(0)";
    link.innerText = a.name;
    link.onclick = () => openAlbum(a.id);
    link.setAttribute("class", "album-link");

    imgWrapper.appendChild(link);
    card.appendChild(imgWrapper);

    return card;
}

async function openAlbum(id) {
    const url = new URL(window.location);
    if (url.searchParams.get("album") != id) {
        if (id) {
            url.searchParams.set("album", id);
        } else {
            url.searchParams.delete("album")
        }
        window.history.pushState({}, "", url);
    }


    let div = document.getElementById("albumDiv")
    div.innerHTML = ""
    let header = document.getElementById("albumHeaderDiv")
    header.innerHTML = ""
    if (id) {
        let allAlbumsLink = document.createElement("a")
        allAlbumsLink.href = "javascript:void(0)"
        allAlbumsLink.innerText = "All albums"
        allAlbumsLink.onclick = () => openAlbum()
        header.appendChild(allAlbumsLink)
        
        let separator = document.createElement("span");
        separator.className = "separator";
        separator.innerText = ">";
        header.appendChild(separator);

        let albumName = document.createElement("a")
        albumName.href = "javascript:void(0)"
        albumName.innerText = ""
        albumName.onclick = () => openAlbum(id)
        header.appendChild(albumName)

        getAlbumName(id).then((name) => {albumName.innerText = name})   

        let files = await getAlbum(id)
        for (let f of files) {
            div.appendChild(fileCard(f))
        }    
    } else {
        const albums = await getAllAlbums()

        for (let a of albums) {
            if (a.bundle.album) {
                let card = albumCard(a)
                div.appendChild(card)
            }
        }

    }
}


function searchCallback(data) {
    let div = document.getElementById("searchDiv")
    div.innerHTML = ""
    if (data.files) {
        for (let d of data.files) {
            div.appendChild(fileCard(d))
        }

    }
}

function impexProgress({ offset, count }) {
    let div = document.getElementById("largeFilesDiv")
    div.innerText = `in progress... ${offset}/${count}`
}

async function exportToOneDriveHandler(e) {
    // ask for model name (popup)
    let name = prompt("Enter model name", "clip")

    let count = await exportToOneDrive(name, impexProgress)
    document.getElementById("largeFilesDiv").innerText = `Exported ${count} embeddings to OneDrive`

}
async function importFromOneDriveHandler(e) {
    // ask for model name (popup)
    let name = prompt("Enter model name", "clip")
    let count = await importFromOneDrive(name, impexProgress)
    document.getElementById("largeFilesDiv").innerText = `Imported ${count} embeddings from OneDrive`
}
async function exportHandler(e) {
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
    let blob = await exportDatabase()
    btn.innerText = "Writing ..."
    await writable.write(blob);
    await writable.close();
    btn.innerText = "Export"
    btn.disabled = false

}
async function podStateHandler(e) {
    console.log("Popstate", e)
    let url = new URL(window.location)
    let folder = url.searchParams.get("folder")
    let album = url.searchParams.get("album")
    let search = url.searchParams.get("search")
    let view = url.searchParams.get("view") 
    if (folder || view == "drive") {
        openFolder(folder)
    }
    if (album || view == "album") {
        openAlbum(album)
    } else if (search) {
        search({ query: search }, searchCallback)
    }
    if (view) {
        activateContent(view)
    } else {
        activateContent("home")
    }
}

async function render() {
    const url = new URL(window.location);
    let currentFolder = url.searchParams.get("folder")
    const fileDiv = document.getElementById("fileDiv");
    fileDiv.innerHTML = ""
    const statusDiv = document.getElementById("statusDiv");
    statusDiv.innerText = "Loading ..."
    app.readFolder(currentFolder, renderFiles).then((files) => {
        statusDiv.innerText = ""
        for (let f of files) {
            let albums = getFileAlbums(f.id)


        }
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
        } else {
            processingDiv.innerText = ""
        }
    }
}

function renderParents(folders) {
    const breadCrumbDiv = document.getElementById("breadCrumb");

    let i = folders.length - 1;
    breadCrumbDiv.innerHTML = "";
    while (i >= 0) {
        if (i < folders.length - 1) {
            let separator = document.createElement("span");
            separator.className = "separator";
            separator.innerText = ">";
            breadCrumbDiv.appendChild(separator);
        }

        let a = document.createElement("a");
        a.href = "javascript:void(0)";
        let id = folders[i].id;
        a.onclick = () => {
            console.log("click", id);
            openFolder(id);
        };
        a.innerText = folders[i].name;
        breadCrumbDiv.appendChild(a);
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

function folderCard(d) {
    const card = document.createElement("div");
    card.setAttribute("class", "folder-card");

    const img = document.createElement("img")
    img.setAttribute("class", "card-img")
    img.setAttribute("id", "img_" + d.id)
    img.setAttribute("height", "160")
    img.setAttribute("src", "folder.svg")
    card.appendChild(img);

    const link = document.createElement('a');
    link.href = 'javascript:void(0)';
    link.textContent = d.name;
    link.setAttribute("class", "folder-link")
    link.addEventListener('click', () => openFolder(d.id));
    card.appendChild(link)
    card.appendChild(document.createElement("br"))
    card.appendChild(small(formatFileSize(d.size, 2)))

    let scanBtn = document.createElement("button")
    scanBtn.innerText = "scan..."
    scanBtn.setAttribute("class", "btn btn-primary btn-sm scan-btn")
    scanBtn.onclick = () => app.cacheAllFiles(d.id)
    card.appendChild(scanBtn)

    return card
}

function fileCard(d) {
    if (d.folder) {
        return folderCard(d)
    }
    const card = document.createElement("div");
    card.setAttribute("class", "card");
    let imgWrapper = document.createElement("div");
    imgWrapper.setAttribute("class", "img-wrapper");

    const img = document.createElement("img")
    img.setAttribute("class", "card-img")
    img.setAttribute("id", "img_" + d.id)
    img.setAttribute("height", "160")
    if (d.image) {
        img.setAttribute("src", "picture.svg")
    } else {
        img.setAttribute("src", "file.svg")
    }
    img.setAttribute("onclick", `window.open("${d.webUrl}")`)
    if (d.thumbnails && d.thumbnails.length > 0 && d.thumbnails[0].large) {
        img.setAttribute("src", d.thumbnails[0].large.url)
    } else if (d.thumbnailUrl) {
        img.setAttribute("src", d.thumbnailUrl)
    }
    imgWrapper.appendChild(img);
    card.appendChild(imgWrapper);

    const body = document.createElement("div")
    body.setAttribute("class", "card-body");
    body.appendChild(small(filePath(d)))
    body.appendChild(document.createElement("br"))
    body.appendChild(small(formatFileSize(d.size, 2)))
    body.appendChild(document.createElement("br"))

    let taken = d.photo && d.photo.takenDateTime || d.createdDateTime
    if (taken) {
        body.appendChild(small(taken))
        body.appendChild(document.createElement("br"))
    }
    if (d.distance) {
        body.appendChild(small("Distance: " + d.distance.toFixed(2)))
        body.appendChild(document.createElement("br"))
    }
    if (d.image) {
        let star = document.createElement("button")
        star.innerText = "★"
        star.setAttribute("id", "star_" + d.id)
        star.setAttribute("class", "star-disabled")
        star.onclick = () => toggleAlbum(d)
        star.enabled = false
        card.appendChild(star)

        let btn = document.createElement("button")
        btn.innerText = "🔎"
        btn.setAttribute("class", "similar-btn")
        btn.onclick = () => searchSimilarHandler(d.id)
        btn.enabled = (d.embeddings) ? true : false
        card.appendChild(btn)
    }
    card.appendChild(body)
    return card
}

function toggleAlbum(d) {
    console.log("Toggle album", d)
    let star = document.getElementById("star_" + d.id)
    if (star.enabled) {
        star.enabled = false
        star.setAttribute("class", "star-disabled")
    } else {
        star.enabled = true
        star.setAttribute("class", "star-enabled")
    }
}

function searchSimilarHandler(id) {
    activateContent("search")
    let query = document.getElementById("searchText").value
    search({ similar: id, query }, searchCallback)
}

async function openFolder(id) {

    const url = new URL(window.location);
    if (!id) {
        id = url.searchParams.get("folder")
    }
    if (url.searchParams.get("folder") != id) {
        console.log("folder", id)

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
    if (!path) return ""
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


export { openFolder }