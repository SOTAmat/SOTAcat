// ----------------------------------------------------------------------------
// Info: Build Version and Type
// ----------------------------------------------------------------------------
function refreshVersion()
{
    if (isLocalhost) return;
    fetchAndUpdateElement('/api/v1/version', 'build-version');
}

function aboutOnAppearing()
{
    refreshVersion();
}

function aboutOnLeaving() {
    // No special cleanup needed for the About tab
}
