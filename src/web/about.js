// ----------------------------------------------------------------------------
// Info: Build Version and Type
// ----------------------------------------------------------------------------
function refreshVersion()
{
    if (gLocalhost) return;
    fetchAndUpdateElement('/api/v1/version', 'buildVersion');
}

function aboutOnAppearing()
{
    refreshVersion();
}

function aboutOnLeaving() {
    // No special cleanup needed for the About tab
}
