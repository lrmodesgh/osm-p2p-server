var test = require('tape')
var request = require('http').request
var tmpdir = require('os').tmpdir()
var path = require('path')
var osmrouter = require('../')
var http = require('http')
var osmdb = require('osm-p2p')
var parsexml = require('xml-parser')
var hyperquest = require('hyperquest')
var concat = require('concat-stream')
var parsexml = require('xml-parser')

var base, server, changeId

test('setup multi-fetch server', function (t) {
  var osm = osmdb(path.join(tmpdir, 'osm-p2p-server-test-' + Math.random()))
  var router = osmrouter(osm)

  server = http.createServer(function (req, res) {
    if (router.handle(req, res)) {}
    else {
      res.statusCode = 404
      res.end('not found\n')
    }
  })
  server.listen(0, function () {
    var port = server.address().port
    base = 'http://localhost:' + port + '/api/0.6/'
    t.end()
  })
})

test('create changeset', function (t) {
  t.plan(3)
  var href = base + 'changeset/create'
  var hq = hyperquest.put(href, {
    headers: { 'content-type': 'text/xml' }
  })
  hq.once('response', function (res) {
    t.equal(res.statusCode, 200, 'create 200 ok')
    t.equal(res.headers['content-type'], 'text/plain', 'create content type')
  })
  hq.pipe(concat({ encoding: 'string' }, function (body) {
    changeId = body.trim()
    t.ok(/^[0-9A-Fa-f]+$/.test(changeId), 'expected changeset id response')
  }))
  hq.end(`<osm>
    <changeset>
      <tag k="comment" v="whatever"/>
    </changeset>
    <changeset>
      <tag k="cool" v="beans"/>
      <tag k="comment" v="wow"/>
    </changeset>
  </osm>`)
})

var uploaded = {}
test('add docs to changeset', function (t) {
  var docs = [
    { type: 'node', lat: 64.5, lon: -121.5, changeset: changeId },
    { type: 'node', lat: 63.9, lon: -120.9, changeset: changeId }
  ]
  t.plan(docs.length * 3)
  docs.forEach(function (doc) {
    var href = base + doc.type + '/create'
    var hq = hyperquest.put(href, {
      headers: { 'content-type': 'text/xml' }
    })
    hq.once('response', function (res) {
      t.equal(res.statusCode, 200)
      t.equal(res.headers['content-type'], 'text/plain')
    })
    hq.pipe(concat({ encoding: 'string' }, function (body) {
      t.ok(/^[0-9A-Fa-f]+$/.test(body.trim()))
      uploaded[doc.lon+','+doc.lat] = body.trim()
    }))
    hq.end(`<osm>
      <node changeset="${doc.changeset}"
        lat="${doc.lat}" lon="${doc.lon}"
        id="IGNOREME">
      </node>
    </osm>`)
  })
})

test('multi-fetch', function (t) {
  t.plan(6)
  var ids = Object.keys(uploaded)
    .map(function (key) { return uploaded[key] })
  var href = base + 'nodes?nodes=' + ids.join(',')
  var hq = hyperquest(href, {
    headers: { 'content-type': 'text/xml' }
  })
  hq.once('response', function (res) {
    t.equal(res.statusCode, 200)
    t.equal(res.headers['content-type'], 'text/xml')
  })
  hq.pipe(concat({ encoding: 'string' }, function (body) {
    var xml = parsexml(body)
    t.equal(xml.root.name, 'osm')
    t.equal(xml.root.children[0].name, 'node')
    t.equal(xml.root.children[1].name, 'node')
    var xids = xml.root.children.map(function (x) {
      return x.attributes.id
    })
    t.deepEqual(xids, ids, 'id comparison')
  }))
})

test('teardown multi-fetch server', function (t) {
  server.close()
  t.end()
})

function cmpch (a, b) {
  return a.attributes.id < b.attributes.id ? -1 : 1
}
