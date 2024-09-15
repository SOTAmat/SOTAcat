function playMsg(slot) {
  // Create the PUT request using Fetch API
  const url = "/api/v1/msg?bank=" + slot;
  fetch(url, { method: "PUT" }).catch((error) =>
    console.error("Fetch error:", error),
  );
}

let isXmitActive = false;

function sendXmitRequest(state) {
  const url = "/api/v1/xmit?state=" + state;
  fetch(url, { method: "PUT" }).catch((error) =>
    console.error("Fetch error:", error)
  );
}

function toggleXmit() {
  const xmitButton = document.getElementById("xmitButton");

  // Toggle the state
  isXmitActive = !isXmitActive;

  // Change button appearance
  if (isXmitActive) {
    xmitButton.classList.add("active");
    sendXmitRequest(1);  // Send "on" signal
  } else {
    xmitButton.classList.remove("active");
    sendXmitRequest(0);  // Send "off" signal
  }
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

function loadInputValues() {
  document.getElementById("message1").value =
    localStorage.getItem("message1") || "";
  document.getElementById("message2").value =
    localStorage.getItem("message2") || "";
  document.getElementById("message3").value =
    localStorage.getItem("message3") || "";
}

function saveInputValues() {
  localStorage.setItem("message1", document.getElementById("message1").value);
  localStorage.setItem("message2", document.getElementById("message2").value);
  localStorage.setItem("message3", document.getElementById("message3").value);
}

gMessageInputListenersAttached = false;

function catOnAppearing() {
  console.info("CAT tab appearing");
  loadInputValues();

  if (!gMessageInputListenersAttached) {
    gMessageInputListenersAttached = true;
    // Add event listeners to save input values when they change
    document
      .getElementById("message1")
      .addEventListener("input", saveInputValues);
    document
      .getElementById("message2")
      .addEventListener("input", saveInputValues);
    document
      .getElementById("message3")
      .addEventListener("input", saveInputValues);
  }
}
