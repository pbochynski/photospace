import * as app from "./app.js";
import { importDatabase, exportDatabase, clearDB, exportToOneDrive, importFromOneDrive } from "./impex.js";
import { dbInfo } from "./db.js";
import { search } from "./search.js";
import { getAllAlbums, getAlbum, indexAlbums, getFileAlbums, getAlbumName } from "./album.js";
import { initPhotoGallery } from "./photos.js"

addEventListener("popstate", (event) => {
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

    const buttons = ['home', 'drive', 'photos', 'search', 'tools', 'album']
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
    addListenerToAll('.photos-button', 'click', () => initPhotoGallery());

    menuButton.addEventListener('click', () => {
        sideMenu.style.display = sideMenu.style.display === 'block' ? 'none' : 'block';
    });
    addToolsButtons()
    setTimeout(() => logProcessingStatus(app.processingStatus()), 1000)
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
async function testGPU() {
    if (navigator.gpu) {
        const adapter = await navigator.gpu.requestAdapter();
        let dType = (adapter.features.has('shader-f16')) ? 'fp16' : 'fp32';
        console.log('Using WebGPU', dType);
    } else {
        console.log('WebGPU not supported, using CPU');
    }
}
function addToolsButtons() {
    const tools = [
        { label: "DB info", fn: dbInfoHandler },
        { label: "Scan All Files", fn: scanAllFiles },
        { label: "Purge embeddings", fn: app.purgeEmbeddings },
        { label: "Clear files", fn: clearDbHandler },
        { label: "Missing Embeddings", fn: app.queueMissingEmbeddings },
        { label: "Duplicates", fn: showDuplicates },
        { label: "Large Files", fn: showLargeFiles },
        { label: "Export", fn: exportHandler },
        { label: "Import", fn: importHandler },
        { label: "Export to OneDrive", fn: exportToOneDriveHandler },
        { label: "Import from OneDrive", fn: importFromOneDriveHandler },
        { label: "Index albums", fn: indexAlbums },
        { label: "GPU test", fn: testGPU },
        { label: "Start worker", fn: app.startEmbeddingWorker },
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

async function dbInfoHandler(e) {
    let info = await dbInfo()
    console.log("DB info", info)
}
async function clearDbHandler(e) {
    let btn = e.target
    btn.disabled = true
    btn.innerText = "Clearing ..."
    await clearDB()
    btn.innerText = "Clear files"
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

        getAlbumName(id).then((name) => { albumName.innerText = name })

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
    console.log(`in progress... ${offset}/${count}`)
}

async function exportToOneDriveHandler(e) {
    // ask for model name (popup)
    let name = prompt("Enter model name", "clip")

    let count = await exportToOneDrive(name, impexProgress)
    console.log(`Exported ${count} embeddings to OneDrive`)

}
async function importFromOneDriveHandler(e) {
    // ask for model name (popup)
    let name = prompt("Enter model name", "clip")
    let count = await importFromOneDrive(name, impexProgress)
    console.log(`Imported ${count} embeddings from OneDrive`)
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
    }
    if (search) {
        search({ query: search }, searchCallback)
    }
    if (view == "photos") {
        initPhotoGallery()
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
// return hours, minutes, seconds, padded with zeros    
function etaString(s) {
    let hours = Math.floor(s / 3600);
    let minutes = Math.floor(s / 60) % 60;
    let seconds = s % 60;
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}` 
}

async function logProcessingStatus(prevStatus) {
    const interval = 5000
    const currentStatus = app.processingStatus()
    let { pending, processed, cacheQueue } = currentStatus
    if (pending != prevStatus.pending || processed != prevStatus.processed) {
        let rate = (processed - prevStatus.processed) * 1000 / interval
        let eta = etaString( rate ? Math.round(pending / rate) : 0)
        console.log(`Processing (${processed}/${pending + processed}), rate: ${rate} files/s, ETA: ${eta}`)
    }
    if (cacheQueue != prevStatus.cacheQueue) {
        console.log(`Cache queue: ${cacheQueue}`)
    }
    setTimeout(() => logProcessingStatus(currentStatus), interval)
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
function button(text, onclick) {
    let btn = document.createElement("button")
    btn.innerText = text
    btn.onclick = onclick
    return btn
}

function filePath(d) {
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
    img.setAttribute("height", "80")
    img.setAttribute("width", "80")
    img.setAttribute("src", "folder.svg")
    card.appendChild(img);

    const link = document.createElement('a');
    link.href = 'javascript:void(0)';
    link.textContent = d.name;
    link.setAttribute("class", "folder-link")
    link.addEventListener('click', () => openFolder(d.id));
    card.appendChild(link)
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
    if (d.score) {
        body.appendChild(small("Score: " + d.score.toFixed(2)))
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

        // Add Trash Button
        let trashBtn = document.createElement("button");
        trashBtn.innerText = "🗑️"; // You can use an SVG icon here instead
        trashBtn.setAttribute("class", "trash-btn");
        trashBtn.onclick = () => {
            app.deleteItems([f])
            card.remove()
        }
        card.appendChild(trashBtn);
    }
    card.appendChild(body)
    return card
}

function deleteFile(f) {

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
    console.log("Duplicates", pairs)

    let div = document.getElementById("largeFilesDiv")
    let keys = Object.keys(pairs).sort((a, b) => pairs[b][0].items.length - pairs[a][0].items.length)
    div.innerHTML = ""
    for (let k of keys) {
        div.appendChild(duplicateCard(k, pairs[k]))
    }
}

function prettyPath(path) {
    if (!path) return ""
    return decodeURI(path.replace('/drive/root:', ''))
}
function duplicateCard(key, d) {
    const div = document.createElement("div");
    const text = document.createElement("div");
    const container1 = document.createElement("div");
    const container2 = document.createElement("div");
    text.innerText = `${d[0].items.length} duplicates`
    div.appendChild(text)
    div.appendChild(small(prettyPath(d[0].path)));
    div.appendChild(document.createElement("br"))

    div.appendChild(button("show", () => {
        for (let f of d[0].items) {
            container1.appendChild(fileCard(f))
        }
    }))
    div.appendChild(button("delete", () => {
        app.deleteItems(d[0].items)
        div.remove()
    }))
    div.appendChild(container1)

    div.appendChild(document.createElement("br"))
    div.appendChild(small(prettyPath(d[1].path)));
    div.appendChild(document.createElement("br"))
    div.appendChild(button("show", () => {
        for (let f of d[1].items) {
            container2.appendChild(fileCard(f))
        }
    }))
    div.appendChild(button("delete", () => {
        app.deleteItems(d[1].items)
        div.remove()
    }))
    div.appendChild(container2)
    return div
}


export { fileCard }