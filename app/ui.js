// Select DOM elements to work with
const signInButton = document.getElementById("SignIn");
const driveHeader = document.getElementById("driveHeader");

function showWelcomeMessage(username) {
    // Reconfiguring DOM elements
    signInButton.setAttribute("onclick", "signOut();");
    signInButton.setAttribute('class', "btn btn-success")
    signInButton.innerHTML = "Sign Out";
}
const folderCache = {}
let currentFolder

function updateUI(data, endpoint) {
    console.log('updateUI context:', endpoint);
    if (endpoint.startsWith(graphConfig.graphFilesEndpoint)) {
        const breadCrumbDiv = document.getElementById("breadCrumb");
        breadCrumbDiv.innerHTML='<b>'+breadCrumb(currentFolder)+'</b>'
        console.log(JSON.stringify(data, null, 2))
        if (!data.value) {
            alert("You do not have onedrive!")
        } else if (data.value.length < 1) {
            alert("Your drive is empty!")
        } else {
            const fileDiv = document.getElementById("fileDiv");
            fileDiv.innerHTML = '';
            data.value.map((d, i) => {
                if (d.folder) {
                    folderCache[d.id]=d
                }
                fileDiv.appendChild(fileCard(d))
            });
        }
    }
}
function parentFolder(id) {

}

function breadCrumb(id) {
    // let html = `<a href="" onclick="goBreadCrumb()>Root</a>`
    let html = ""
    while (folderCache[id]) {
        let name = folderCache[id].name
        if (html == "") {
            html = `${name}`
        } else {
            html = `<a href="#" onclick="openFolder('${id}')">${name}</a>/` + html
        }
        id = folderCache[id].parentReference.id
    }
    if (html=="") {
        html="My files"
    } else {
        html = `<a href="#" onclick="openFolder()">My files</a>/` + html
    }
    return html;
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
    img.setAttribute("class","card-img")
    img.setAttribute("id","img_"+d.id)
    if (d.folder) {
        img.setAttribute("src","folder.svg")
    } else {
        img.setAttribute("src","picture.svg")        
    }
    if (d.image) {
        thumbnails(d.id, (data, endpoint)=>(updateThumbnail(data, img)))
    }
    card.appendChild(img);
    body.setAttribute("class", "card-body");
    let name = `${d.name}<br/>`

    if (d.folder) {
        name = `<a href="#" onclick="openFolder('${d.id}')">${d.name}</a><br/>`
    }
    body.innerHTML = `${name}<small>${formatFileSize(d.size, 2)}</small>`
    card.appendChild(body)
    col.appendChild(card)
    return col
}

function openFolder(id) {
    currentFolder=id;
    readFiles(id, updateUI)
}

function updateThumbnail(data, img) {
    console.log("AAAAAAAA", JSON.stringify(data,null,2))
    if (data.value && data.value.length>0 && data.value[0].large) {
      console.log("Changed src to:", data.value[0].large.url)
      img.setAttribute("src",data.value[0].large.url)

    }
    // document.getElementById("img_"+data.)
}
