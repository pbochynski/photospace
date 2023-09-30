// Select DOM elements to work with
const signInButton = document.getElementById("SignIn");
const driveHeader = document.getElementById("driveHeader");

function showWelcomeMessage(username) {
    // Reconfiguring DOM elements
    signInButton.setAttribute("onclick", "signOut();");
    signInButton.setAttribute('class', "btn btn-success")
    signInButton.innerHTML = "Sign Out";
}

addEventListener("popstate", (event) => {
    console.log("Popstate event")
    render()
});

function render() {
    const url = new URL(window.location);
    let currentFolder = url.searchParams.get("folder")
    const fileDiv = document.getElementById("fileDiv");
    fileDiv.innerHTML = '';
    readFiles(currentFolder, renderFiles)
    parentFolders([{id:currentFolder}],renderParents)
}

function renderParents(folders){
    const breadCrumbDiv = document.getElementById("breadCrumb");

    let i=folders.length-1
    let html = ""
    while (i>0) {
        html+= `/ <a href="javascript:void(0)" onclick="openFolder('${folders[i].id}')">${folders[i].name}</a>`
        --i;
    }
    breadCrumbDiv.innerHTML = html
}
function renderFiles(data) {
    if (!data.value) {
        alert("You do not have onedrive!")
    } else {
        const fileDiv = document.getElementById("fileDiv");
        data.value.map((d, i) => {
            fileDiv.appendChild(fileCard(d))
        });
    }
    cacheFiles(data)
}
async function onRoot(data) {
    openFolder(data.id)
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
    let name = `${d.name}<br/>`

    if (d.folder) {
        name = `<a href="javascript:void(0)" onclick="openFolder('${d.id}')">${d.name}</a><br/>`
    }
    body.innerHTML = `<small>${prettyPath(d.parentReference.path)}<br/>${name}${formatFileSize(d.size, 2)}</small>`
    card.appendChild(body)
    col.appendChild(card)
    return col
}

async function openFolder(id) {

    const url = new URL(window.location);
    if (!id) {
        id = url.searchParams.get("folder")
    }
    if (!id) {
        console.log("Find root folder")
        rootFolder(onRoot)
    } else {
        if (url.searchParams.get("folder")!=id){
            url.searchParams.set("folder", id);
            window.history.pushState({}, "", url);    
        }
        render()
    }
}
function scanAllFiles() {
    cacheAllFiles(onScanLog)
}
function onScanLog({urls,processed}) {
    let log = document.getElementById("scanLog")
    log.innerHTML = `<small>${urls.map((o)=>o.path.replace('/drive/root:','')).join("<br/>")}</small>`
}

async function showLargeFiles() {
    
    let list = await largeFiles()
    let div = document.getElementById("largeFilesDiv")
    div.innerHTML=''
    for (let d of list) {
        div.appendChild(fileCard(d))
    }
}
let pairs = {}
async function showDuplicates() {
    pairs = await findDuplicates()


    let div = document.getElementById("largeFilesDiv")
    let keys = Object.keys(pairs).sort((a,b)=> pairs[b][0].items.length-pairs[a][0].items.length)    
    div.innerHTML=""
    for (let k of keys) {
        div.appendChild(duplicateCard(k, pairs[k]))
    }
    // for (let d of list) {
    //     div.appendChild(fileCard(d))
    // }
}

function prettyPath(path) {
    return decodeURI(path.replace('/drive/root:',''))
}
function duplicateCard(key, d) {
    const col = document.createElement("div");
    col.setAttribute("class", "col")
    const card = document.createElement("div");
    card.setAttribute("class", "card h-100");
    const body = document.createElement("div")
    body.setAttribute("class", "card-body");
    let html=`${d[0].items.length} duplicates<br/>`
    html+=`<small>${prettyPath(d[0].path)}</small><br/>`
    html+=`<button onclick="showDetails('${key}',0)">show</button><button onclick="deleteDuplicates('${key}',0)">delete</button><br/>`
    html+=`<small>${prettyPath(d[1].path)}</small><br/>`
    html+=`<button onclick="showDetails('${key}',1)">show</button><button onclick="deleteDuplicates('${key}',1)">delete</button>`
    body.innerHTML = html
    card.appendChild(body)
    col.appendChild(card)
    return col
}
function showDetails(key,index) {
    document.getElementById("detail-tab").click()
    let div = document.getElementById("detailDiv")
    div.innerHTML=""
    console.log("Details for:",pairs[key][index].items.length)
    for (let f of pairs[key][index].items) {

        div.appendChild(fileCard(f))
    }

}

async function deleteDuplicates(key, index) {
    deleteItems(pairs[key][index].items).then((res)=>{
        deleteFromCache(pairs[key][index].items)
        console.log(res)
    })
}