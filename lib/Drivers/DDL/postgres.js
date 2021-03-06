exports.drop = function (driver, opts, cb) {
	var i, queries = [], pending;

	queries.push("DROP TABLE IF EXISTS " + driver.query.escapeId(opts.table));

	for (i = 0; i < opts.many_associations.length; i++) {
		queries.push("DROP TABLE IF EXISTS " + driver.query.escapeId(opts.many_associations[i].mergeTable));
	}

	pending = queries.length;
	for (i = 0; i < queries.length; i++) {
		driver.db.query(queries[i], function (err) {
			if (--pending === 0) {
				return cb(err);
			}
		});
	}
};

exports.sync = function (driver, opts, cb) {
	var tables = [];
	var subqueries = [];
	var typequeries = [];
	var definitions = [];
	var k, i, pending;

	definitions.push(driver.query.escapeId(opts.id) + " SERIAL PRIMARY KEY");

	for (k in opts.properties) {
		definitions.push(buildColumnDefinition(driver, opts.table, k, opts.properties[k]));

		if (opts.properties[k].type == "enum") {
			typequeries.push(
				"CREATE TYPE " + driver.query.escapeId("enum_" + opts.table + "_" + k) + " AS ENUM (" +
				opts.properties[k].values.map(driver.query.escapeVal.bind(driver)) + ")"
			);
		}
	}

	for (i = 0; i < opts.one_associations.length; i++) {
		if (opts.one_associations[i].reversed) continue;
		definitions.push(
			driver.query.escapeId(opts.one_associations[i].field) + " INTEGER" +
			(opts.one_associations[i].required ? ' NOT NULL' : '')
		);
	}

	for (k in opts.properties) {
		if (opts.properties[k].unique === true) {
			definitions.push("UNIQUE (" + driver.query.escapeId(k) + ")");
		}
	}

	tables.push({
		name       : opts.table,
		query      : "CREATE TABLE " + driver.query.escapeId(opts.table) +
		             " (" + definitions.join(", ") + ")",
		typequeries: typequeries,
		subqueries : subqueries
	});
	tables[tables.length - 1].subqueries.push(
		"CREATE INDEX ON " + driver.query.escapeId(opts.table) +
		" (" + driver.query.escapeId(opts.id) + ")"
	);

	for (i = 0; i < opts.one_associations.length; i++) {
		if (opts.one_associations[i].reversed) continue;
		tables[tables.length - 1].subqueries.push(
			"CREATE INDEX ON " + driver.query.escapeId(opts.table) +
			" (" + driver.query.escapeId(opts.one_associations[i].field) + ")"
		);
	}

	for (i = 0; i < opts.many_associations.length; i++) {
		definitions = [];
		typequeries = [];

		definitions.push(driver.query.escapeId(opts.many_associations[i].mergeId) + " INTEGER NOT NULL");
		definitions.push(driver.query.escapeId(opts.many_associations[i].mergeAssocId) + " INTEGER NOT NULL");

		for (k in opts.many_associations[i].props) {
			definitions.push(buildColumnDefinition(driver, opts.many_associations[i].mergeTable,
			                                       k, opts.many_associations[i].props[k]));
			if (opts.many_associations[i].props[k].type == "enum") {
				typequeries.push(
					"CREATE TYPE " + driver.query.escapeId("enum_" + opts.many_associations[i].mergeTable + "_" + k) + " AS ENUM (" +
					opts.many_associations[i].props[k].values.map(driver.query.escapeVal.bind(driver)) + ")"
				);
			}
		}

		tables.push({
			name       : opts.many_associations[i].mergeTable,
			query      : "CREATE TABLE IF NOT EXISTS " + driver.query.escapeId(opts.many_associations[i].mergeTable) +
			             " (" + definitions.join(", ") + ")",
			typequeries: typequeries,
			subqueries : []
		});
		tables[tables.length - 1].subqueries.push(
			"CREATE INDEX ON " + driver.query.escapeId(opts.many_associations[i].mergeTable) +
			" (" +
			driver.query.escapeId(opts.many_associations[i].mergeId) + ", " +
			driver.query.escapeId(opts.many_associations[i].mergeAssocId) +
			")"
		);
	}

	pending = tables.length;

	for (i = 0; i < tables.length; i++) {
		createTableSchema(driver, tables[i], function (err) {
			if (--pending === 0) {
				// this will bring trouble in the future...
				// some errors are not avoided (like ENUM types already defined, etc..)
				return cb(err);
			}
		});
	}
};

function createTableSchema(driver, table, cb) {
	var pending = table.typequeries.length;
	var createTable = function () {
		driver.db.query(table.query, function (err) {
			if (err || table.subqueries.length === 0) {
				return cb();
			}

			var pending = table.subqueries.length;

			for (var i = 0; i < table.subqueries.length; i++) {
				driver.db.query(table.subqueries[i], function (err) {
					if (--pending === 0) {
						return cb();
					}
				});
			}
		});
	};

	if (pending === 0) {
		return createTable();
	}

	for (var i = 0; i < table.typequeries.length; i++) {
		driver.db.query(table.typequeries[i], function (err) {
			if (--pending === 0) {
				return createTable();
			}
		});
	}
}

function buildColumnDefinition(driver, table, name, prop) {
	var def;

	switch (prop.type) {
		case "text":
			def = driver.query.escapeId(name) + " VARCHAR(" + Math.min(Math.max(parseInt(prop.size, 10) || 255, 1), 65535) + ")";
			break;
		case "number":
			if (prop.rational === false) {
				def = driver.query.escapeId(name) + " INTEGER";
			} else {
				def = driver.query.escapeId(name) + " REAL";
			}
			break;
		case "boolean":
			def = driver.query.escapeId(name) + " BOOLEAN NOT NULL";
			break;
		case "date":
			if (prop.time === false) {
				def = driver.query.escapeId(name) + " DATE";
			} else {
				def = driver.query.escapeId(name) + " TIMESTAMP WITHOUT TIME ZONE";
			}
			break;
		case "binary":
		case "object":
			def = driver.query.escapeId(name) + " BYTEA";
			break;
		case "enum":
			def = driver.query.escapeId(name) + " " + driver.query.escapeId("enum_" + table + "_" + name);
			break;
		default:
			throw new Error("Unknown property type: '" + prop.type + "'");
	}
	if (prop.hasOwnProperty("defaultValue")) {
		def += " DEFAULT " + driver.escape(prop.defaultValue);
	}
	return def;
}
