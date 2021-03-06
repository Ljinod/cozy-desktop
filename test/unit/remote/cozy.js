/* eslint-env mocha */
/* @flow weak */

const should = require('should')

const RemoteCozy = require('../../../core/remote/cozy')
const { DirectoryNotFound } = RemoteCozy

const configHelpers = require('../../support/helpers/config')
const { COZY_URL, builders, deleteAll } = require('../../support/helpers/cozy')
const CozyStackDouble = require('../../support/doubles/cozy_stack')

const cozyStackDouble = new CozyStackDouble()

describe('RemoteCozy', function () {
  before(() => cozyStackDouble.start())
  beforeEach(deleteAll)
  before('instanciate config', configHelpers.createConfig)
  before('register OAuth client', configHelpers.registerClient)
  after('clean config directory', configHelpers.cleanConfig)
  after(() => cozyStackDouble.stop())
  afterEach(() => cozyStackDouble.clearStub())

  let remoteCozy

  beforeEach(function () {
    this.config.cozyUrl = COZY_URL
    remoteCozy = new RemoteCozy(this.config)
  })

  describe('changes', function () {
    it('resolves with changes since then given seq', async function () {
      const { last_seq } = await remoteCozy.changes()

      const dir = await builders.remote.dir().create()
      const file = await builders.remote.file().inDir(dir).create()

      const { docs } = await remoteCozy.changes(last_seq)
      const ids = docs.map(doc => doc._id)

      should(ids.sort()).eql([file._id, dir._id].sort())
    })

    it('resolves with all changes since the db creation when no seq given', async function () {
      const dir = await builders.remote.dir().create()
      const file = await builders.remote.file().inDir(dir).create()

      const { docs } = await remoteCozy.changes()
      const ids = docs.map(doc => doc._id)

      should(ids).containEql(dir._id)
      should(ids).containEql(file._id)
      should(ids.length).be.greaterThan(2)
    })

    it('does not swallow errors', function () {
      this.config.cozyUrl = cozyStackDouble.url()
      const remoteCozy = new RemoteCozy(this.config)

      cozyStackDouble.stub((req, res) => {
        res.writeHead(500, {'Content-Type': 'text/plain'})
        res.end('whatever')
      })

      return should(remoteCozy.changes()).be.rejected()
    })
  })

  describe('find', function () {
    it('fetches a remote directory matching the given id', async function () {
      const remoteDir = await builders.remote.dir().create()

      const foundDir = await remoteCozy.find(remoteDir._id)

      foundDir.should.be.deepEqual(remoteDir)
    })

    it('fetches a remote root file including its path', async function () {
      const remoteFile = await builders.remote.file().inRootDir().named('foo').create()

      const foundFile = await remoteCozy.find(remoteFile._id)

      foundFile.should.deepEqual({
        ...remoteFile,
        path: '/foo'
      })
    })

    it('fetches a remote non-root file including its path', async function () {
      const remoteDir = await builders.remote.dir().named('foo').inRootDir().create()
      const remoteFile = await builders.remote.file().named('bar').inDir(remoteDir).create()

      const foundFile = await remoteCozy.find(remoteFile._id)

      foundFile.should.deepEqual({
        ...remoteFile,
        path: '/foo/bar'
      })
    })
  })

  describe('findMaybe', function () {
    it('does the same as find() when file or directory exists', async function () {
      const remoteDir = await builders.remote.dir().create()

      const foundDir = await remoteCozy.findMaybe(remoteDir._id)

      foundDir.should.deepEqual(remoteDir)
    })

    it('returns null when file or directory is not found', async function () {
      const found = await remoteCozy.findMaybe('missing')

      should.not.exist(found)
    })
  })

  describe('findDirectoryByPath', function () {
    it('resolves when the directory exists remotely', async function () {
      const dir = await builders.remote.dir().create()
      const subdir = await builders.remote.dir().inDir(dir).create()

      const foundDir = await remoteCozy.findDirectoryByPath(dir.path)
      delete foundDir.created_at
      foundDir.should.deepEqual(dir)

      const foundSubdir = await remoteCozy.findDirectoryByPath(subdir.path)
      delete foundSubdir.created_at
      foundSubdir.should.deepEqual(subdir)
    })

    it('rejects when the directory does not exist remotely', async function () {
      await builders.remote.file().named('existing').inRootDir().create()

      for (let path of ['/missing', '/existing/missing']) {
        await remoteCozy.findDirectoryByPath(path)
          .should.be.rejectedWith(DirectoryNotFound)
      }
    })

    it('rejects when the path matches a file', async function () {
      await builders.remote.file().named('foo').inRootDir().create()

      await remoteCozy.findDirectoryByPath('/foo')
        .should.be.rejectedWith(DirectoryNotFound)
    })
  })

  describe('findOrCreateDirectoryByPath', () => {
    it('resolves with the exisisting directory if any', async function () {
      const root = await remoteCozy.findDirectoryByPath('/')
      const dir = await builders.remote.dir().create()
      const subdir = await builders.remote.dir().inDir(dir).create()

      let result = await remoteCozy.findOrCreateDirectoryByPath(root.path)
      should(result).have.properties(root)
      result = await remoteCozy.findOrCreateDirectoryByPath(dir.path)
      should(result).have.properties(dir)
      result = await remoteCozy.findOrCreateDirectoryByPath(subdir.path)
      should(result).have.properties(subdir)
    })

    if (process.platform === 'win32' && process.env.CI) {
      it.skip('creates any missing parent directory (unstable on AppVeyor)', () => {})
    } else {
      it('creates any missing parent directory', async function () {
        const dir = await builders.remote.dir().named('dir').create()
        await builders.remote.dir().named('subdir').inDir(dir).create()

        let result = await remoteCozy.findOrCreateDirectoryByPath('/dir/subdir/foo')
        should(result).have.properties({
          type: 'directory',
          path: '/dir/subdir/foo'
        })
        result = await remoteCozy.findOrCreateDirectoryByPath('/dir/bar/baz')
        should(result).have.properties({
          type: 'directory',
          path: '/dir/bar/baz'
        })
        result = await remoteCozy.findOrCreateDirectoryByPath('/foo/bar/qux')
        should(result).have.properties({
          type: 'directory',
          path: '/foo/bar/qux'
        })
      })
    }

    it('does not swallow errors', async function () {
      this.config.cozyUrl = cozyStackDouble.url()
      const remoteCozy = new RemoteCozy(this.config)

      cozyStackDouble.stub((req, res) => {
        res.writeHead(500, {'Content-Type': 'text/plain'})
        res.end('Whatever')
      })

      await should(remoteCozy.findOrCreateDirectoryByPath('/whatever'))
        .be.rejected()
    })
  })

  describe('isEmpty', () => {
    it('is true when the folder with the given id is empty', async function () {
      const dir = await builders.remote.dir().create()
      should(await remoteCozy.isEmpty(dir._id)).be.true()

      const subdir = await builders.remote.dir().inDir(dir).create()
      should(await remoteCozy.isEmpty(dir._id)).be.false()
      should(await remoteCozy.isEmpty(subdir._id)).be.true()

      await builders.remote.file().inDir(dir).create()
      should(await remoteCozy.isEmpty(dir._id)).be.false()
      should(await remoteCozy.isEmpty(subdir._id)).be.true()

      await builders.remote.file().inDir(subdir).create()
      should(await remoteCozy.isEmpty(dir._id)).be.false()
      should(await remoteCozy.isEmpty(subdir._id)).be.false()
    })

    it('rejects when given a file id', async function () {
      const file = await builders.remote.file().create()
      await should(remoteCozy.isEmpty(file._id)).be.rejectedWith(/wrong type/)
    })

    it('rejects when no document matches the id', async function () {
      await should(remoteCozy.isEmpty('missing')).be.rejectedWith({status: 404})
    })
  })

  describe('downloadBinary', function () {
    it('resolves with a Readable stream of the file content', async function () {
      const remoteFile = await builders.remote.file().data('foo').create()

      const stream = await remoteCozy.downloadBinary(remoteFile._id)

      let data = ''
      stream.on('data', chunk => { data += chunk })
      stream.on('end', () => { data.should.equal('foo') })
    })
  })
})
