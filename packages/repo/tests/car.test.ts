import { CID } from 'multiformats/cid'
import * as ui8 from 'uint8arrays'
import { dataToCborBlock, streamToBytes, wait } from '@atproto/common'
import { CarBlock, readCarStream, writeCarStream } from '../src'
import fixtures from './car-file-fixtures.json'

describe('car', () => {
  for (const fixture of fixtures) {
    it('correctly writes car files', async () => {
      const root = CID.parse(fixture.root)
      async function* blockIter() {
        for (const block of fixture.blocks) {
          const cid = CID.parse(block.cid)
          const bytes = ui8.fromString(block.bytes, 'base64')
          yield { cid, bytes }
        }
      }
      const carStream = writeCarStream(root, blockIter())
      const car = await streamToBytes(carStream)
      const carB64 = ui8.toString(car, 'base64')
      expect(carB64).toEqual(fixture.car)
    })

    it('correctly reads carfiles', async () => {
      const carStream = [ui8.fromString(fixture.car, 'base64')]
      const { roots, blocks } = await readCarStream(carStream)
      expect(roots.length).toBe(1)
      expect(roots[0].toString()).toEqual(fixture.root)
      const carBlocks: CarBlock[] = []
      for await (const block of blocks) {
        carBlocks.push(block)
      }
      expect(carBlocks.length).toEqual(fixture.blocks.length)
      for (let i = 0; i < carBlocks.length; i++) {
        expect(carBlocks[i].cid.toString()).toEqual(fixture.blocks[i].cid)
        expect(ui8.toString(carBlocks[i].bytes, 'base64')).toEqual(
          fixture.blocks[i].bytes,
        )
      }
    })
  }

  it('writeCar propagates errors', async () => {
    const iterate = async () => {
      async function* blockIterator() {
        await wait(1)
        const block = await dataToCborBlock({ test: 1 })
        yield block
        throw new Error('Oops!')
      }
      const iter = writeCarStream(null, blockIterator())
      for await (const _bytes of iter) {
        // no-op
      }
    }
    await expect(iterate).rejects.toThrow('Oops!')
  })

  it('verifies CIDs', async () => {
    const block0 = await dataToCborBlock({ block: 0 })
    const block1 = await dataToCborBlock({ block: 1 })
    const block2 = await dataToCborBlock({ block: 2 })
    const block3 = await dataToCborBlock({ block: 3 })
    const badBlock = await dataToCborBlock({ block: 'bad' })
    const blockIter = async function* () {
      yield block0
      yield block1
      yield block2
      yield { cid: block3.cid, bytes: badBlock.bytes }
    }
    const flush = async function (iter: AsyncIterable<unknown>) {
      for await (const _ of iter) {
        // no-op
      }
    }
    const badCar = await readCarStream(writeCarStream(block0.cid, blockIter()))
    await expect(flush(badCar.blocks)).rejects.toThrow(
      'Not a valid CID for bytes',
    )
  })

  it('skips CID verification', async () => {
    const block0 = await dataToCborBlock({ block: 0 })
    const block1 = await dataToCborBlock({ block: 1 })
    const block2 = await dataToCborBlock({ block: 2 })
    const block3 = await dataToCborBlock({ block: 3 })
    const badBlock = await dataToCborBlock({ block: 'bad' })
    const blockIter = async function* () {
      yield block0
      yield block1
      yield block2
      yield { cid: block3.cid, bytes: badBlock.bytes }
    }
    const flush = async function (iter: AsyncIterable<unknown>) {
      for await (const _ of iter) {
        // no-op
      }
    }
    const badCar = await readCarStream(
      writeCarStream(block0.cid, blockIter()),
      { skipCidVerification: true },
    )
    await expect(flush(badCar.blocks)).resolves.toBeUndefined()
  })

  describe('varint and frame bounds', () => {
    it('rejects continuation-only input exceeding max varint width', async () => {
      const continuationBytes = new Uint8Array(100).fill(0x80)
      await expect(readCarStream([continuationBytes])).rejects.toThrow(
        'could not parse varint: exceeded maximum width',
      )
    })

    it('rejects varints wider than 8 bytes', async () => {
      // 9 bytes
      const wideVarint = new Uint8Array([
        0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01,
      ])
      await expect(readCarStream([wideVarint])).rejects.toThrow(
        'could not parse varint: exceeded maximum width',
      )
    })

    it('rejects non-canonical varint encodings', async () => {
      // 0x80 0x00 is non-canonical encoding of 0
      const nonCanonicalZero = new Uint8Array([0x80, 0x00])
      await expect(readCarStream([nonCanonicalZero])).rejects.toThrow(
        'could not parse varint: non-canonical encoding',
      )
    })

    it('rejects truncated varint input with unexpected EOF', async () => {
      const truncatedVarint = new Uint8Array([0x81])
      await expect(readCarStream([truncatedVarint])).rejects.toThrow(
        'could not parse varint: unexpected EOF',
      )
    })

    it('rejects varints exceeding Number.MAX_SAFE_INTEGER', async () => {
      // 8 bytes encoding 2^56 - 1 > Number.MAX_SAFE_INTEGER (2^53 - 1)
      const overflowVarint = new Uint8Array([
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f,
      ])
      await expect(readCarStream([overflowVarint])).rejects.toThrow(
        'could not parse varint: integer overflow',
      )
    })

    it('rejects truncated CAR header frame', async () => {
      // Varint header size = 100, but only 2 header bytes provided
      const truncatedHeader = new Uint8Array([100, 0x01, 0x02])
      await expect(readCarStream([truncatedHeader])).rejects.toThrow(
        'Truncated CAR header',
      )
    })
  })
})
