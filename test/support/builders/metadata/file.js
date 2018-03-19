/* @flow */

import type { Metadata } from '../../../../core/metadata'

const BaseMetadataBuilder = require('./base')
const { assignId } = require('../../../../core/metadata')
const Pouch = require('../../../../core/pouch')

const pouchdbBuilders = require('../pouchdb')

module.exports = class FileMetadataBuilder extends BaseMetadataBuilder {
  fileOpts: {
    size: number,
    md5sum: string
  }

  constructor (pouch: ?Pouch) {
    super(pouch)
    this.fileOpts = {
      size: 0,
      md5sum: ''
    }
  }

  data (data: string): this {
    this.fileOpts.size = Buffer.from(data).length
    // TODO: md5sum
    return this
  }

  build (): Metadata {
    const doc = {
      _id: '',
      // _rev: pouchdbBuilders.rev(),
      docType: 'file',
      remote: {
        _id: pouchdbBuilders.id(),
        _rev: pouchdbBuilders.rev()
      },
      tags: [],
      updated_at: new Date(),
      ...this.opts,
      ...this.fileOpts
    }
    assignId(doc)
    return doc
  }
}
