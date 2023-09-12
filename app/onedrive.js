const rootUrl = "https://graph.microsoft.com/v1.0/me/drive/root:/Pictures/Camera%20Roll:/children"


function callMSGraph(endpoint, token, callback) {
    const headers = new Headers();
    const bearer = `Bearer ${token}`;

    headers.append("Authorization", bearer);

    const options = {
        method: "GET",
        headers: headers
    };

    console.log('request made to Graph API at: ' + new Date().toString(), endpoint);

    fetch(endpoint, options)
        .then(response => response.json())
        .then(response => callback(response, endpoint))
        .catch(error => console.log(error));
}

function readFiles(id, callback) {
    const path = (id) ? `/items/${id}` : `/root`
    getTokenRedirect(tokenRequest)
        .then(response => {
            callMSGraph(graphConfig.graphFilesEndpoint + path + '/children', response.accessToken, callback);
        }).catch(error => {
            console.error(error);
        });
}

function thumbnails(id, callback) {
    getTokenRedirect(tokenRequest)
        .then(response => {
            callMSGraph(graphConfig.graphFilesEndpoint + `/items/${id}/thumbnails`, response.accessToken, callback);
        }).catch(error => {
            console.error(error);
        });

}

