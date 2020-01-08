require('dotenv').config()
const { ApolloServer, UserInputError, gql } = require('apollo-server')
const uuid = require('uuid/v1')
const mongoose = require('mongoose')
const Book = require('./models/book')
const Author = require('./models/author')

mongoose.set('useFindAndModify', false)

const MONGODB_URI = process.env.MONGODB_URI
console.log('connecting to', MONGODB_URI)

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('connected to MongoDB')
  })
  .catch((error) => {
    console.log('error connecting to MongoDB:', error.message)
  })

const typeDefs = gql`
  type Author {
    name: String!
    id: ID!
    born: Int
    bookCount: Int!
  }

  type Book {
    title: String!
    published: Int!
    author: Author!
    genres: [String!]!
    id: ID!
  }

  type Query {
    bookCount: Int!
    authorCount: Int!
    allBooks(author: String, genre: String): [Book!]!
    allAuthors: [Author!]!
  }

  type Mutation {
    addBook(
      title: String!
      author: String!
      published: Int!
      genres: [String!]!
    ): Book
    editAuthor(
      name: String!
      setBornTo: Int!
    ): Author
  }
`

const resolvers = {
  Query: {
    bookCount: () => { return Book.collection.countDocuments() },
    authorCount: () => { return Author.collection.countDocuments() },
    allBooks: (root, args) => { 
      if (!args.author && !args.genre) return Book.find({}) 
      let query = {}
      if(args.author) query.author = args.author
      if(args.genre) query.genres = args.genre
      console.log(query)
      return Book.find(query)
    },
    allAuthors: () => { return Author.find({}) }
  },
  Mutation: {
    addBook: async (root, args) => {
      let book
      try {
        const author = await Author.findOneAndUpdate({ name: args.author}, { name: args.author }, { upsert: true, new: true, runValidators: true })
        book = new Book({ ...args, author })
        await book.save()
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }
      return book
    },
    editAuthor: async (root, args) => {
      let author
      try {
        author = await Author.findOneAndUpdate({ name: args.name }, { born: args.setBornTo }, { new: true })
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }
      return author
    }
  },
  Book: {
    author: async root => {
      const author = await Author.findById(root.author)
      console.log(author)
      return {
        name: author.name,
        born: author.born
      }
    }
  },
  Author: {
    bookCount: (root) => { 
      return Book.count({ author: root.name })
    }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
})

server.listen().then(({ url }) => {
  console.log(`Server ready at ${url}`)
})
