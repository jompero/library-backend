require('dotenv').config()
const jwt = require('jsonwebtoken')
const { ApolloServer, UserInputError, AuthenticationError, gql, PubSub } = require('apollo-server')
const uuid = require('uuid/v1')
const mongoose = require('mongoose')
const Book = require('./models/book')
const Author = require('./models/author')
const User = require('./models/user')

mongoose.set('useFindAndModify', false)

const SECRET = process.env.MONGODB_URI

const MONGODB_URI = process.env.MONGODB_URI
console.log('connecting to', MONGODB_URI)

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('connected to MongoDB')
  })
  .catch((error) => {
    console.log('error connecting to MongoDB:', error.message)
  })

const pubsub = new PubSub()

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

  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }

  type Token {
    value: String!
  }

  type Genres {
    values: [String!]!
  }

  type Query {
    bookCount: Int!
    authorCount: Int!
    allBooks(author: String, genre: String): [Book!]!
    allAuthors: [Author!]!
    me: User
    allGenres: Genres!
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
    createUser(
      username: String!
      favoriteGenre: String!
    ): User
    login(
      username: String!
      password: String!
    ): Token
  }

  type Subscription {
    bookAdded: Book!
  }
`

const resolvers = {
  Query: {
    bookCount: () => { return Book.collection.countDocuments() },
    authorCount: () => { return Author.collection.countDocuments() },
    allBooks: async (root, args) => { 
      if (!args.author && !args.genre) return Book.find({}) 
      let query = {}
      if(args.author) query.author = args.author
      if(args.genre) query.genres = args.genre
      console.log(query)
      const books = await Book.find(query)
      return books ? books : []
    },
    allAuthors: () => { return Author.find({}) },
    me: (root, args, context) => {
      return context.currentUser
    },
    allGenres: async () => {
      // There's probably a better/cleaner way to filter the genres out :D
      const books = await Book.find({})
      const genres = books.map(book => {
        return book.genres
      })
      console.log(genres)
      const uniqueGenres = [ ...new Set(genres.flat())]
      console.log(uniqueGenres)
      return {values: uniqueGenres }
    }
  },
  Mutation: {
    addBook: async (root, args, context) => {
      const currentUser = context.currentUser
      console.log('adding new book, user', currentUser)

      if (!currentUser) {
        throw new AuthenticationError("You do not have permission to perform this request")
      }

      let book
      try {
        const author = await Author.findOneAndUpdate({ name: args.author}, { name: args.author }, { upsert: true, new: true, runValidators: true })
        author.bookCount = author.bookCount ? author.bookCount + 1 : 1
        await author.save()
        
        book = new Book({ ...args, author })
        await book.save()

      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }

      pubsub.publish('BOOK_ADDED', { bookAdded: book })
      return book
    },
    editAuthor: async (root, args, context) => {
      const currentUser = context.currentUser

      if (!currentUser) {
        throw new AuthenticationError("You do not have permission to perform this request")
      }

      let author
      try {
        author = await Author.findOneAndUpdate({ name: args.name }, { born: args.setBornTo }, { new: true })
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }
      return author
    },
    createUser: async (root, args) => {
      console.log('requesting with args', args)
      const user = new User({ username: args.username, favoriteGenre: args.favoriteGenre })
      console.log('creating user', user)
      try {
        await user.save()
        console.log('user saved', user)
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        })
      }
      return user
    },
    login: async (root, args) => {
      console.log('requesting to log in with args', args)
      const user = await User.findOne({ username: args.username })
      console.log('user found', user)
  
      if ( !user || args.password !== 'password' ) {
        console.log('invalid args', args)
        throw new UserInputError("Invalid username or password")
      }
  
      const userForToken = {
        username: user.username,
        id: user._id,
      }
      
      const token = jwt.sign(userForToken, SECRET)
      console.log('token created', token)
      return { value: token }
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
  Subscription: {
    bookAdded: {
      subscribe: () => pubsub.asyncIterator(['BOOK_ADDED'])
    },
  }
}

const context = async ({ req }) => {
  //console.log('running context', req.headers)
  const auth = req ? req.headers.authorization : null
  //console.log('auth', auth)
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const decodedToken = jwt.verify(
      auth.substring(7), SECRET
    )
    //console.log('decoded token', decodedToken)
    const currentUser = await User.findById(decodedToken.id).populate('friends')
    //console.log('user', currentUser)
    return { currentUser }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context
})

server.listen().then(({ url, subscriptionsUrl }) => {
  console.log(`Server ready at ${url}`)
  console.log(`Subs ready at ${subscriptionsUrl}`)
})
