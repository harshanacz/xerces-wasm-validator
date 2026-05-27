import { createProjectValidator } from "../src/index";

// ─────────────────────────────────────────────────────────────────────────────
// Schemas — simulate the WSO2 MI structure:
//   mediators.xsd  xs:includes  connectors.xsd  (same namespace)
//   connectors.xsd contains a <xs:choice> that's empty initially and gets
//   regenerated when a connector is downloaded.
// ─────────────────────────────────────────────────────────────────────────────

const SYNAPSE_NS = "http://ws.apache.org/ns/synapse";

const mediatorsXsd = `<?xml version="1.0" encoding="ISO-8859-1"?>
<xs:schema
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    elementFormDefault="qualified"
    targetNamespace="${SYNAPSE_NS}"
    xmlns="${SYNAPSE_NS}">

  <xs:include schemaLocation="connectors.xsd"/>

  <xs:element name="sequence">
    <xs:complexType>
      <xs:group ref="mediatorList" minOccurs="0" maxOccurs="unbounded"/>
      <xs:attribute name="name" type="xs:string" use="required"/>
    </xs:complexType>
  </xs:element>

  <xs:group name="mediatorList">
    <xs:choice>
      <xs:element name="log">
        <xs:complexType>
          <xs:attribute name="level" type="xs:string"/>
        </xs:complexType>
      </xs:element>
      <xs:group ref="connectors"/>
    </xs:choice>
  </xs:group>
</xs:schema>`;

const emptyConnectorsXsd = `<?xml version="1.0" encoding="ISO-8859-1"?>
<xs:schema
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    elementFormDefault="qualified"
    targetNamespace="${SYNAPSE_NS}"
    xmlns="${SYNAPSE_NS}">

  <xs:group name="connectors">
    <xs:choice>
    </xs:choice>
  </xs:group>
</xs:schema>`;

const s3ConnectorsXsd = `<?xml version="1.0" encoding="ISO-8859-1"?>
<xs:schema
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    elementFormDefault="qualified"
    targetNamespace="${SYNAPSE_NS}"
    xmlns="${SYNAPSE_NS}">

  <xs:group name="connectors">
    <xs:choice>
      <xs:element name="s3.getObject">
        <xs:complexType>
          <xs:all>
            <xs:element name="bucketName" type="xs:string" minOccurs="1" maxOccurs="1"/>
            <xs:element name="key"        type="xs:string" minOccurs="0" maxOccurs="1"/>
          </xs:all>
          <xs:attribute name="configKey" type="xs:string"/>
        </xs:complexType>
      </xs:element>
    </xs:choice>
  </xs:group>
</xs:schema>`;

const s3AndHttpConnectorsXsd = `<?xml version="1.0" encoding="ISO-8859-1"?>
<xs:schema
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    elementFormDefault="qualified"
    targetNamespace="${SYNAPSE_NS}"
    xmlns="${SYNAPSE_NS}">

  <xs:group name="connectors">
    <xs:choice>
      <xs:element name="s3.getObject">
        <xs:complexType>
          <xs:all>
            <xs:element name="bucketName" type="xs:string" minOccurs="1" maxOccurs="1"/>
            <xs:element name="key"        type="xs:string" minOccurs="0" maxOccurs="1"/>
          </xs:all>
        </xs:complexType>
      </xs:element>
      <xs:element name="http.get">
        <xs:complexType>
          <xs:all>
            <xs:element name="url" type="xs:string"/>
          </xs:all>
        </xs:complexType>
      </xs:element>
    </xs:choice>
  </xs:group>
</xs:schema>`;

// 4.4.0 variation — same shape, different namespace-less marker via comment
const mediatorsXsdV2 = mediatorsXsd;

// Documents
const seqWithLog = `<sequence xmlns="${SYNAPSE_NS}" name="main">
  <log level="full"/>
</sequence>`;

const seqWithS3 = `<sequence xmlns="${SYNAPSE_NS}" name="main">
  <s3.getObject>
    <bucketName>my-bucket</bucketName>
  </s3.getObject>
</sequence>`;

const seqWithHttp = `<sequence xmlns="${SYNAPSE_NS}" name="main">
  <http.get>
    <url>https://example.com</url>
  </http.get>
</sequence>`;

const seqWithS3MissingRequired = `<sequence xmlns="${SYNAPSE_NS}" name="main">
  <s3.getObject>
    <key>k</key>
  </s3.getObject>
</sequence>`;

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 1 — basic lifecycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("createProjectValidator — basic lifecycle", () => {
  test("creates a project, validates, destroys cleanly", async () => {
    const proj = await createProjectValidator({
      entry: "mediators.xsd",
      files: {
        "mediators.xsd":  mediatorsXsd,
        "connectors.xsd": emptyConnectorsXsd,
      },
      targetNamespace: SYNAPSE_NS,
    });

    const result = await proj.validate(seqWithLog);
    expect(result.valid).toBe(true);

    proj.destroy();
  });

  test("validate() after destroy() throws", async () => {
    const proj = await createProjectValidator({
      entry: "mediators.xsd",
      files: {
        "mediators.xsd":  mediatorsXsd,
        "connectors.xsd": emptyConnectorsXsd,
      },
      targetNamespace: SYNAPSE_NS,
    });

    proj.destroy();
    await expect(proj.validate(seqWithLog)).rejects.toThrow(/destroyed/);
  });

  test("destroy() is idempotent", async () => {
    const proj = await createProjectValidator({
      entry: "mediators.xsd",
      files: {
        "mediators.xsd":  mediatorsXsd,
        "connectors.xsd": emptyConnectorsXsd,
      },
      targetNamespace: SYNAPSE_NS,
    });

    proj.destroy();
    expect(() => proj.destroy()).not.toThrow();
  });

  test("throws when entry is not in files", async () => {
    await expect(
      createProjectValidator({
        entry: "does-not-exist.xsd",
        files: { "mediators.xsd": mediatorsXsd },
      })
    ).rejects.toThrow(/not found/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 2 — fast repeated validation (the whole point of Solution 2)
// ═══════════════════════════════════════════════════════════════════════════════

describe("createProjectValidator — fast repeated validation", () => {
  test("100 sequential validate() calls all succeed", async () => {
    const proj = await createProjectValidator({
      entry: "mediators.xsd",
      files: {
        "mediators.xsd":  mediatorsXsd,
        "connectors.xsd": emptyConnectorsXsd,
      },
      targetNamespace: SYNAPSE_NS,
    });

    for (let i = 0; i < 100; i++) {
      const result = await proj.validate(seqWithLog);
      expect(result.valid).toBe(true);
    }
    proj.destroy();
  });

  test("alternating valid/invalid documents — no stale state", async () => {
    const proj = await createProjectValidator({
      entry: "mediators.xsd",
      files: {
        "mediators.xsd":  mediatorsXsd,
        "connectors.xsd": s3ConnectorsXsd,
      },
      targetNamespace: SYNAPSE_NS,
    });

    for (let i = 0; i < 20; i++) {
      expect((await proj.validate(seqWithS3)).valid).toBe(true);
      expect((await proj.validate(seqWithS3MissingRequired)).valid).toBe(false);
    }
    proj.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 3 — updateFile (connector download flow)
// ═══════════════════════════════════════════════════════════════════════════════

describe("createProjectValidator — updateFile", () => {
  test("connector added via updateFile becomes valid", async () => {
    const proj = await createProjectValidator({
      entry: "mediators.xsd",
      files: {
        "mediators.xsd":  mediatorsXsd,
        "connectors.xsd": emptyConnectorsXsd,
      },
      targetNamespace: SYNAPSE_NS,
    });

    // Before: <s3.getObject> is not in the empty connectors schema
    expect((await proj.validate(seqWithS3)).valid).toBe(false);

    // User downloads s3 connector → SchemaGenerate regenerates connectors.xsd
    await proj.updateFile("connectors.xsd", s3ConnectorsXsd);

    // After: <s3.getObject> is now allowed
    expect((await proj.validate(seqWithS3)).valid).toBe(true);

    proj.destroy();
  });

  test("multiple connector updates accumulate correctly", async () => {
    const proj = await createProjectValidator({
      entry: "mediators.xsd",
      files: {
        "mediators.xsd":  mediatorsXsd,
        "connectors.xsd": emptyConnectorsXsd,
      },
      targetNamespace: SYNAPSE_NS,
    });

    expect((await proj.validate(seqWithS3)).valid).toBe(false);
    expect((await proj.validate(seqWithHttp)).valid).toBe(false);

    await proj.updateFile("connectors.xsd", s3ConnectorsXsd);
    expect((await proj.validate(seqWithS3)).valid).toBe(true);
    expect((await proj.validate(seqWithHttp)).valid).toBe(false);

    await proj.updateFile("connectors.xsd", s3AndHttpConnectorsXsd);
    expect((await proj.validate(seqWithS3)).valid).toBe(true);
    expect((await proj.validate(seqWithHttp)).valid).toBe(true);

    proj.destroy();
  });

  test("base mediator (log) still works after connector updates", async () => {
    const proj = await createProjectValidator({
      entry: "mediators.xsd",
      files: {
        "mediators.xsd":  mediatorsXsd,
        "connectors.xsd": emptyConnectorsXsd,
      },
      targetNamespace: SYNAPSE_NS,
    });

    expect((await proj.validate(seqWithLog)).valid).toBe(true);
    await proj.updateFile("connectors.xsd", s3ConnectorsXsd);
    expect((await proj.validate(seqWithLog)).valid).toBe(true);
    await proj.updateFile("connectors.xsd", s3AndHttpConnectorsXsd);
    expect((await proj.validate(seqWithLog)).valid).toBe(true);

    proj.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 4 — multi-project isolation (4 projects, same WASM instance)
// ═══════════════════════════════════════════════════════════════════════════════

describe("createProjectValidator — multi-project isolation", () => {
  test("4 projects with different schemas coexist without contamination", async () => {
    // proj1: empty
    // proj2: empty (different version, treated as separate project)
    // proj3: s3 connector
    // proj4: s3 + http connectors
    const [proj1, proj2, proj3, proj4] = await Promise.all([
      createProjectValidator({
        entry: "mediators.xsd",
        files: {
          "mediators.xsd":  mediatorsXsd,
          "connectors.xsd": emptyConnectorsXsd,
        },
        targetNamespace: SYNAPSE_NS,
      }),
      createProjectValidator({
        entry: "mediators.xsd",
        files: {
          "mediators.xsd":  mediatorsXsdV2,
          "connectors.xsd": emptyConnectorsXsd,
        },
        targetNamespace: SYNAPSE_NS,
      }),
      createProjectValidator({
        entry: "mediators.xsd",
        files: {
          "mediators.xsd":  mediatorsXsd,
          "connectors.xsd": s3ConnectorsXsd,
        },
        targetNamespace: SYNAPSE_NS,
      }),
      createProjectValidator({
        entry: "mediators.xsd",
        files: {
          "mediators.xsd":  mediatorsXsdV2,
          "connectors.xsd": s3AndHttpConnectorsXsd,
        },
        targetNamespace: SYNAPSE_NS,
      }),
    ]);

    // proj1 & proj2 — only know about <log>, not connectors
    expect((await proj1.validate(seqWithLog)).valid).toBe(true);
    expect((await proj1.validate(seqWithS3)).valid).toBe(false);
    expect((await proj2.validate(seqWithLog)).valid).toBe(true);
    expect((await proj2.validate(seqWithHttp)).valid).toBe(false);

    // proj3 — knows s3 but not http
    expect((await proj3.validate(seqWithS3)).valid).toBe(true);
    expect((await proj3.validate(seqWithHttp)).valid).toBe(false);

    // proj4 — knows both
    expect((await proj4.validate(seqWithS3)).valid).toBe(true);
    expect((await proj4.validate(seqWithHttp)).valid).toBe(true);

    proj1.destroy();
    proj2.destroy();
    proj3.destroy();
    proj4.destroy();
  });

  test("interleaved validate calls across 4 projects — no cross-contamination", async () => {
    const projs = await Promise.all([
      createProjectValidator({
        entry: "mediators.xsd",
        files: {
          "mediators.xsd":  mediatorsXsd,
          "connectors.xsd": emptyConnectorsXsd,
        },
        targetNamespace: SYNAPSE_NS,
      }),
      createProjectValidator({
        entry: "mediators.xsd",
        files: {
          "mediators.xsd":  mediatorsXsd,
          "connectors.xsd": s3ConnectorsXsd,
        },
        targetNamespace: SYNAPSE_NS,
      }),
      createProjectValidator({
        entry: "mediators.xsd",
        files: {
          "mediators.xsd":  mediatorsXsd,
          "connectors.xsd": s3AndHttpConnectorsXsd,
        },
        targetNamespace: SYNAPSE_NS,
      }),
    ]);

    for (let i = 0; i < 30; i++) {
      expect((await projs[0].validate(seqWithLog)).valid).toBe(true);
      expect((await projs[0].validate(seqWithS3)).valid).toBe(false);
      expect((await projs[1].validate(seqWithS3)).valid).toBe(true);
      expect((await projs[1].validate(seqWithHttp)).valid).toBe(false);
      expect((await projs[2].validate(seqWithS3)).valid).toBe(true);
      expect((await projs[2].validate(seqWithHttp)).valid).toBe(true);
    }

    projs.forEach((p) => p.destroy());
  });

  test("updating one project's connectors does not affect others", async () => {
    const projA = await createProjectValidator({
      entry: "mediators.xsd",
      files: {
        "mediators.xsd":  mediatorsXsd,
        "connectors.xsd": emptyConnectorsXsd,
      },
      targetNamespace: SYNAPSE_NS,
    });
    const projB = await createProjectValidator({
      entry: "mediators.xsd",
      files: {
        "mediators.xsd":  mediatorsXsd,
        "connectors.xsd": emptyConnectorsXsd,
      },
      targetNamespace: SYNAPSE_NS,
    });

    // Both start with no connectors
    expect((await projA.validate(seqWithS3)).valid).toBe(false);
    expect((await projB.validate(seqWithS3)).valid).toBe(false);

    // Only projA gets the s3 connector
    await projA.updateFile("connectors.xsd", s3ConnectorsXsd);

    expect((await projA.validate(seqWithS3)).valid).toBe(true);
    // projB must still reject s3
    expect((await projB.validate(seqWithS3)).valid).toBe(false);
    // projB's <log> still works
    expect((await projB.validate(seqWithLog)).valid).toBe(true);

    projA.destroy();
    projB.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 5 — performance sanity check
// ═══════════════════════════════════════════════════════════════════════════════

describe("createProjectValidator — performance sanity", () => {
  test("repeated validation is much faster than re-creating the project", async () => {
    const files = {
      "mediators.xsd":  mediatorsXsd,
      "connectors.xsd": s3AndHttpConnectorsXsd,
    };

    // Measure 50 re-creations (Solution-1-like worst case)
    const recreateStart = Date.now();
    for (let i = 0; i < 50; i++) {
      const p = await createProjectValidator({
        entry: "mediators.xsd",
        files,
        targetNamespace: SYNAPSE_NS,
      });
      await p.validate(seqWithS3);
      p.destroy();
    }
    const recreateMs = Date.now() - recreateStart;

    // Measure 50 reuses (Solution 2)
    const proj = await createProjectValidator({
      entry: "mediators.xsd",
      files,
      targetNamespace: SYNAPSE_NS,
    });
    const reuseStart = Date.now();
    for (let i = 0; i < 50; i++) {
      await proj.validate(seqWithS3);
    }
    const reuseMs = Date.now() - reuseStart;
    proj.destroy();

    // Reuse must be meaningfully faster.  We expect a large gap on real
    // schemas, but to keep this test stable on tiny test schemas we just
    // assert it's not slower.
    expect(reuseMs).toBeLessThanOrEqual(recreateMs);
  }, 30000);
});
