function playMsg(slot) {
  // Create the PUT request using Fetch API
  const url = "/api/v1/msg?bank=" + slot;
  fetch(url, { method: "PUT" }).catch((error) =>
    console.error("Fetch error:", error),
  );
}

function setPowerMinMax(maximum) {
  const url = "/api/v1/power?power=" + (maximum ? "10" : "0");
  fetch(url, { method: "PUT" }).catch((error) =>
    console.error("Fetch error:", error),
  );
}

function sendKeys(message) {
  if (message.length < 1 || message.length > 24)
    alert("Text length must be [1..24] characters.");
  else {
    const url = "/api/v1/keyer?message=" + message;
    fetch(url, { method: "PUT" }).catch((error) =>
      console.error("Fetch error:", error),
    );
  }
}

function settingsOnAppearing() {}
