const examples = {
  valid: {
    code: `import { validate } from "xerces-wasm";

const result = await validate(xmlText, xsdText);

if (result.valid) {
  console.log("Ready to ship");
}`,
    result: {
      valid: true,
      parseErrors: [],
      schemaErrors: []
    }
  },
  schema: {
    code: `import { validate } from "xerces-wasm";

const result = await validate(
  "<person><age>bad</age></person>",
  personSchema
);`,
    result: {
      valid: false,
      parseErrors: [],
      schemaErrors: [
        {
          message: "Value 'bad' is not valid for xs:integer",
          line: 1,
          column: 14,
          severity: "error"
        }
      ]
    }
  },
  bundle: {
    code: `import { validate } from "xerces-wasm";

const result = await validate(xmlText, {
  entry: mainXsd,
  imports: {
    "types.xsd": typesXsd,
    "common.xsd": commonXsd
  }
});`,
    result: {
      valid: true,
      parseErrors: [],
      schemaErrors: []
    }
  }
};

const sampleCode = document.querySelector("#sampleCode");
const resultJson = document.querySelector("#resultJson");
const resultStatus = document.querySelector("#resultStatus");
const tabs = Array.from(document.querySelectorAll(".demo-tab"));

function renderExample(name) {
  const example = examples[name];

  sampleCode.textContent = example.code;
  resultJson.textContent = JSON.stringify(example.result, null, 2);
  resultStatus.textContent = example.result.valid ? "Validation passed" : "Validation failed";
  resultStatus.classList.toggle("invalid", !example.result.valid);

  tabs.forEach((tab) => {
    const active = tab.dataset.example === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => renderExample(tab.dataset.example));
});

renderExample("valid");
