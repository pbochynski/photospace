# PhotoSpace

![Clean and organized workspace with beautiful photos](./app/banner.png)

## Quick start

- Launch [photospace.app](https://photospace.app) in your browser
- Sign in to you onedrive and give access to the photospace app
- In the _Clean up_ section click _Scan all files_ (it can take a while)
- Click _Duplicates_ to find out what you can remove
  
## Features
- analyse onedrive files (not only photos) - cache in local storage (indexeddb)
- find and remove duplicates (by sha256)
- find largest files

## Privacy
The application works entirely in your browser. There is no server side or any shared component that has access to your files. Full source code is in this repository and application is hosted on github pages. 

## Data deletion concerns
Application requires permission to delete files, but onedrive API doesn't allow to delete files permanently. The files are moved to the recycle bin and you can recover them within 30 days after deletion.

## Coming next (backlog)
- face recognition
- advanced filtering by geolocation, time, people, scene, colors
- finding groups of photos with the biggest storage waste (similar photos that can be discarded)
