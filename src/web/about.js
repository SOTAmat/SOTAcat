// ----------------------------------------------------------------------------
// Info: Build Version and Type
// ----------------------------------------------------------------------------
function refreshVersion()
{
    if (isLocalhost) return;
    fetchAndUpdateElement('/api/v1/version', 'build-version');
}

function onAboutAppearing()
{
    refreshVersion();
}

function onAboutLeaving() {
    // No special cleanup needed for the About tab
}
