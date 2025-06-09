console.log("Vite Env Variables:", import.meta.env); 

import { PublicClientApplication, LogLevel } from '@azure/msal-browser';

const msalConfig = {
    auth: {
        clientId: import.meta.env.VITE_AZURE_CLIENT_ID,
        authority: "https://login.microsoftonline.com/common",
        redirectUri: window.location.origin,
    },
    cache: {
        cacheLocation: "sessionStorage", // or "localStorage"
        storeAuthStateInCookie: false,
    },
    system: {
        loggerOptions: {
            loggerCallback: (level, message, containsPii) => {
                if (containsPii) { return; }
                switch (level) {
                    case LogLevel.Error:
                        console.error(message);
                        return;
                    case LogLevel.Info:
                        // console.info(message);
                        return;
                    case LogLevel.Verbose:
                        // console.debug(message);
                        return;
                    case LogLevel.Warning:
                        console.warn(message);
                        return;
                }
            }
        }
    }
};

export const msalInstance = new PublicClientApplication(msalConfig);

const loginRequest = {
    scopes: ["User.Read", "Files.Read.All"]
};

export async function login() {
    try {
        const response = await msalInstance.loginPopup(loginRequest);
        msalInstance.setActiveAccount(response.account);
        return response.account;
    } catch (error) {
        console.error("Login failed:", error);
        throw error;
    }
}

export function logout() {
    const logoutRequest = {
        account: msalInstance.getActiveAccount(),
        postLogoutRedirectUri: window.location.origin
    };
    msalInstance.logoutPopup(logoutRequest);
}

export async function getAuthToken() {
    const account = msalInstance.getActiveAccount();
    if (!account) {
        throw new Error("User not signed in.");
    }

    const request = {
        scopes: ["Files.Read.All"],
        account: account
    };

    try {
        const response = await msalInstance.acquireTokenSilent(request);
        return response.accessToken;
    } catch (error) {
        console.warn("Silent token acquisition failed. Acquiring token using popup.");
        const response = await msalInstance.acquireTokenPopup(request);
        return response.accessToken;
    }
}